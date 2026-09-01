/**
 * The end-to-end demonstration, as a test.
 *
 * Natural language → compiler → schema gate → semantic gate → canonicalization →
 * commitment → agent proposals → deterministic enforcement → receipts →
 * independent verification. The OpenAI call is the only thing substituted, and
 * only because a test that depends on a live model is not a test.
 */
import {
  DEMO_SCENARIO,
  IntentProofClient,
  LocalRegistryClient,
  StaticIntentCompiler,
  computeIntentHash,
  ledgerFromHistory,
  type AuthorizedIntent,
  type ExecutionReceipt,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-09-01T12:00:00Z');

const USER_WORDS = `Manage my portfolio. You can swap ETH and STRK. Don't use leverage.
Don't spend more than $500 per transaction. Only use approved protocols.`;

/** What a well-behaved model returns for the words above. */
const MODEL_PROPOSAL = {
  purpose: 'portfolio_management',
  allowedActions: ['swap'],
  forbiddenActions: ['borrow', 'leverage', 'short'],
  allowedAssets: ['ETH', 'STRK'],
  allowedContracts: ['APPROVED_DEX_1', 'APPROVED_DEX_2'],
  allowedDestinations: null,
  maxTransactionValueUsd: 500,
  maxDailySpendUsd: 1000,
  maxSlippageBps: 100,
  durationHours: 24,
  explanation:
    'Swaps between ETH and STRK on the two approved venues, capped at $500 per transaction. Borrowing, leverage and shorting are refused. No daily figure was given, so $1,000 was proposed as twice the per-transaction cap.',
};

function client(): IntentProofClient {
  return new IntentProofClient({
    compiler: new StaticIntentCompiler(MODEL_PROPOSAL),
    registry: new LocalRegistryClient('starknet-sepolia'),
    clock: () => NOW,
    agentId: 'agent_demo_001',
  });
}

async function authorized(): Promise<{ sdk: IntentProofClient; intent: AuthorizedIntent }> {
  const sdk = client();
  const compiled = await sdk.compileIntent({ naturalLanguage: USER_WORDS });
  const { intent } = await sdk.authorize({ policy: compiled.policy });
  return { sdk, intent };
}

describe('compile → review → authorize', () => {
  it('produces a policy that reflects the user words', async () => {
    const compiled = await client().compileIntent({ naturalLanguage: USER_WORDS });
    expect(compiled.policy.allowedActions).toEqual(['swap']);
    expect(compiled.policy.forbiddenActions).toEqual(['borrow', 'leverage', 'short']);
    expect(compiled.policy.allowedAssets).toEqual(['ETH', 'STRK']);
    expect(compiled.policy.maxTransactionValueUsd).toBe(500);
    expect(compiled.policy.expiresAt).toBe('2026-09-02T12:00:00Z');
  });

  it('commits the policy to a reproducible hash', async () => {
    const { intent } = await authorized();
    expect(intent.intentHash).toBe(computeIntentHash(intent.policy));
    expect(intent.intentHash).toMatch(/^0x[0-9a-f]{64}$/u);

    // Two independent runs of the same words reach the same commitment.
    const again = await authorized();
    expect(again.intent.intentHash).toBe(intent.intentHash);
  });

  it('says LOCAL DEMO MODE rather than inventing a transaction', async () => {
    const { intent } = await authorized();
    expect(intent.mode).toBe('LOCAL_DEMO');
    expect(intent.anchor).toBeNull();
  });
});

describe('the agent run', () => {
  it('allows in-policy actions and rejects everything outside the grant', async () => {
    const { sdk, intent } = await authorized();
    const engine = sdk.engineFor(intent);

    const outcomes = DEMO_SCENARIO.map((step, index) => {
      const action = step.build(intent, index);
      const { evaluation, receipt } = engine.decide({ action });
      return { step, action, evaluation, receipt };
    });

    const allowed = outcomes.filter((o) => o.evaluation.allowed);
    const rejected = outcomes.filter((o) => !o.evaluation.allowed);

    expect(outcomes).toHaveLength(7);
    expect(allowed).toHaveLength(3);
    expect(rejected).toHaveLength(4);

    // The engine's verdict agrees with what each scripted step was meant to show.
    // Nothing forces this: the labels are inert and the engine never sees them.
    for (const outcome of outcomes) {
      expect(
        outcome.evaluation.allowed ? 'expected-allow' : 'expected-reject',
        `${outcome.step.label} disagreed with the engine`,
      ).toBe(outcome.step.intendedOutcome);
    }

    // Each rejection fails the rule it exists to demonstrate. Several fail more
    // than one, because a $2,000 borrow really is wrong in five different ways
    // and the receipt says all five rather than picking a headline.
    expect(rejected.map((r) => r.evaluation.failedChecks.join('+'))).toEqual([
      'action_allowed+action_not_forbidden+asset_allowed+contract_allowed+transaction_limit+daily_limit',
      'action_allowed+destination_allowed',
      'asset_allowed',
      'transaction_limit+daily_limit',
    ]);
  });

  it('records zero unauthorized executions', async () => {
    const { sdk, intent } = await authorized();
    const engine = sdk.engineFor(intent);
    const receipts = DEMO_SCENARIO.map((step, i) => engine.decide({ action: step.build(intent, i) }).receipt);

    const executed = receipts.filter((r) => r.policyResult === 'ALLOWED');
    const unauthorizedExecutions = executed.filter((r) => r.checks.some((c) => !c.passed));
    expect(unauthorizedExecutions).toHaveLength(0);

    // The ledger only ever advanced for the allowed actions.
    expect(engine.ledger.executedActionIds).toHaveLength(executed.length);
  });

  it('produces a receipt for every action, including the refusals', async () => {
    const { sdk, intent } = await authorized();
    const engine = sdk.engineFor(intent);
    const receipts = DEMO_SCENARIO.map((step, i) => engine.decide({ action: step.build(intent, i) }).receipt);

    expect(receipts).toHaveLength(DEMO_SCENARIO.length);
    expect(new Set(receipts.map((r) => r.receiptHash)).size).toBe(receipts.length);
    for (const receipt of receipts) {
      expect(receipt.intentHash).toBe(intent.intentHash);
      expect(receipt.transactionHash).toBeNull();
    }
  });
});

describe('verification', () => {
  async function run(): Promise<{
    sdk: IntentProofClient;
    intent: AuthorizedIntent;
    receipts: ExecutionReceipt[];
  }> {
    const { sdk, intent } = await authorized();
    const engine = sdk.engineFor(intent);
    const receipts = DEMO_SCENARIO.map((step, i) => engine.decide({ action: step.build(intent, i) }).receipt);
    return { sdk, intent, receipts };
  }

  it('verifies every receipt from the run', async () => {
    const { sdk, intent, receipts } = await run();
    for (const [index, receipt] of receipts.entries()) {
      const report = await sdk.verify({
        intent,
        receipt,
        ledgerBefore: ledgerFromHistory(receipts.slice(0, index)),
      });
      expect(report.failedFindings, `receipt ${index} failed`).toEqual([]);
      // Local mode cannot confirm a transaction, so the honest verdict is
      // INDETERMINATE rather than a claim of on-chain proof.
      expect(report.verdict).toBe('INDETERMINATE');
    }
  });

  it('reaches EXECUTION WITHIN INTENT once a chain confirms the receipt', async () => {
    const { sdk, intent, receipts } = await run();
    const onChainIntent: AuthorizedIntent = { ...intent, mode: 'STARKNET_SEPOLIA' };
    const report = await sdk.verify({
      intent: onChainIntent,
      receipt: receipts[0]!,
      onChain: { verified: true, failureCode: null },
    });
    expect(report.verdict).toBe('EXECUTION_WITHIN_INTENT');
  });

  it('reports EXECUTION NOT AUTHORIZED when the chain disagrees', async () => {
    const { sdk, intent, receipts } = await run();
    const report = await sdk.verify({
      intent: { ...intent, mode: 'STARKNET_SEPOLIA' },
      receipt: receipts[0]!,
      onChain: { verified: false, failureCode: 'IP: agent not authorized' },
    });
    expect(report.verdict).toBe('EXECUTION_NOT_AUTHORIZED');
    expect(report.failedFindings.map((f) => f.name)).toContain('transaction_association');
  });

  it('names the rule that failed when a receipt is forged', async () => {
    const { sdk, intent, receipts } = await run();
    const rejection = receipts.find((r) => r.policyResult === 'REJECTED')!;
    const forged: ExecutionReceipt = { ...rejection, policyResult: 'ALLOWED' };

    const report = await sdk.verify({ intent, receipt: forged });
    expect(report.verdict).toBe('EXECUTION_NOT_AUTHORIZED');
    expect(report.failedFindings.map((f) => f.name)).toEqual(
      expect.arrayContaining(['receipt_integrity', 'policy_evaluation']),
    );
  });

  it('detects a policy edited after the fact', async () => {
    const { sdk, intent, receipts } = await run();
    const tampered: AuthorizedIntent = {
      ...intent,
      policy: { ...intent.policy, maxTransactionValueUsd: 100_000 },
    };
    const report = await sdk.verify({ intent: tampered, receipt: receipts[0]! });
    expect(report.verdict).toBe('EXECUTION_NOT_AUTHORIZED');
    expect(report.failedFindings.map((f) => f.name)).toContain('policy_integrity');
  });
});

describe('revocation and expiry', () => {
  it('stops an agent the moment the user revokes', async () => {
    const { sdk, intent } = await authorized();
    const revoked: AuthorizedIntent = { ...intent, revokedAt: '2026-09-01T11:59:00Z' };
    const result = sdk.checkAction(revoked, DEMO_SCENARIO[0]!.build(intent, 0));
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toEqual(['intent_not_revoked']);
  });

  it('stops an agent once the authorization lapses', async () => {
    const { intent } = await authorized();
    const later = new IntentProofClient({
      compiler: new StaticIntentCompiler(MODEL_PROPOSAL),
      registry: new LocalRegistryClient(),
      clock: () => new Date('2026-09-03T12:00:00Z'),
    });
    const result = later.checkAction(intent, DEMO_SCENARIO[0]!.build(intent, 0));
    expect(result.failedChecks).toEqual(['intent_not_expired']);
  });
});

describe('the SDK surface an integrator sees', () => {
  it('checkPolicy needs no client, environment or I/O', async () => {
    const { IntentProof } = await import('../src/index.js');
    const { intent } = await authorized();
    const borrowStep = DEMO_SCENARIO.find((s) => s.label.startsWith('Borrow'))!;
    const result = IntentProof.checkPolicy(intent, borrowStep.build(intent, 2), {
      now: NOW,
    });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('action_not_forbidden');
  });

  it('never records a rejected action on chain', async () => {
    const { sdk, intent } = await authorized();
    const engine = sdk.engineFor(intent);
    const rejectedStep = DEMO_SCENARIO.find((s) => s.intendedOutcome === 'expected-reject')!;
    const { receipt } = engine.decide({ action: rejectedStep.build(intent, 3) });
    expect(receipt.policyResult).toBe('REJECTED');
    expect(await sdk.recordExecution(intent, receipt)).toBeNull();
  });
});
