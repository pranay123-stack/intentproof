import {
  commitPolicy,
  intentIdFromHash,
  type AgentAction,
  type AuthorizedIntent,
  type IntentPolicy,
} from '@intentproof/intent-schema';
import { describe, expect, it } from 'vitest';
import { CHECK_ORDER, EMPTY_LEDGER, applyToLedger, dayIndex, evaluateAction } from '../src/index.js';

const NOW = new Date('2026-09-01T12:00:00Z');

const POLICY: IntentPolicy = {
  version: 1,
  purpose: 'portfolio_management',
  allowedActions: ['swap'],
  forbiddenActions: ['borrow', 'leverage', 'short'],
  allowedAssets: ['ETH', 'STRK'],
  allowedContracts: ['APPROVED_DEX_1', 'APPROVED_DEX_2'],
  maxTransactionValueUsd: 500,
  maxDailySpendUsd: 1000,
  maxSlippageBps: 100,
  expiresAt: '2026-09-02T12:00:00Z',
  metadata: { explanation: 'Swaps between ETH and STRK only.' },
};

function makeIntent(policy: IntentPolicy = POLICY, overrides: Partial<AuthorizedIntent> = {}): AuthorizedIntent {
  const { canonical, intentHash } = commitPolicy(policy);
  return {
    intentId: intentIdFromHash(intentHash),
    intentHash,
    canonical,
    policy,
    creator: 'local',
    agentId: 'agent_demo_001',
    createdAt: '2026-09-01T11:00:00Z',
    expiresAt: policy.expiresAt,
    mode: 'LOCAL_DEMO',
    network: 'starknet-sepolia',
    anchor: null,
    revokedAt: null,
    revocationAnchor: null,
    sequence: 0,
    ...overrides,
  };
}

const SWAP: AgentAction = {
  id: 'act_001',
  kind: 'swap',
  assetIn: 'ETH',
  assetOut: 'STRK',
  valueUsd: 420,
  slippageBps: 60,
  targetContract: 'APPROVED_DEX_1',
};

const run = (action: AgentAction, overrides: Partial<Parameters<typeof evaluateAction>[0]> = {}) =>
  evaluateAction({ intent: makeIntent(), action, now: NOW, ...overrides });

describe('evaluateAction — shape of the result', () => {
  it('runs every check, in the protocol order, on every call', () => {
    const result = run(SWAP);
    expect(result.checks.map((c) => c.name)).toEqual([...CHECK_ORDER]);
  });

  it('does not stop at the first failure', () => {
    // A single action can be wrong in several ways and the receipt should say so.
    const result = run({
      ...SWAP,
      kind: 'borrow',
      assetOut: 'DOGE',
      valueUsd: 5000,
      targetContract: 'UNKNOWN_VENUE',
      slippageBps: 900,
    });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks.length).toBeGreaterThan(4);
    expect(result.checks).toHaveLength(CHECK_ORDER.length);
  });

  it('reports a reason for each failed check', () => {
    const result = run({ ...SWAP, valueUsd: 5000 });
    expect(result.reasons).toHaveLength(result.failedChecks.length);
    expect(result.reasons.join(' ')).toContain('$500');
  });
});

describe('evaluateAction — the demo scenario', () => {
  it('allows an in-policy swap', () => {
    const result = run(SWAP);
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('allows the reverse swap on the other approved venue', () => {
    const result = run({
      ...SWAP,
      id: 'act_002',
      assetIn: 'STRK',
      assetOut: 'ETH',
      valueUsd: 350,
      targetContract: 'APPROVED_DEX_2',
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects a forbidden action, naming both the allowlist and the denylist', () => {
    const result = run({
      id: 'act_003',
      kind: 'borrow',
      assetOut: 'USDC',
      valueUsd: 2000,
      targetContract: 'APPROVED_LENDING_1',
    });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('action_allowed');
    expect(result.failedChecks).toContain('action_not_forbidden');
    expect(result.failedChecks).toContain('transaction_limit');
  });

  it('rejects a transfer to an address the policy never named', () => {
    const result = run({
      id: 'act_004',
      kind: 'transfer',
      assetIn: 'ETH',
      valueUsd: 180,
      targetContract: 'APPROVED_DEX_1',
      destination: '0x04b2c1a9f7e8d3c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4',
    });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('destination_allowed');
    expect(result.checks.find((c) => c.name === 'destination_allowed')?.detail).toContain(
      'no destination allowlist',
    );
  });

  it('rejects an unauthorized asset', () => {
    const result = run({ ...SWAP, id: 'act_005', assetOut: 'DOGE', valueUsd: 120 });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toEqual(['asset_allowed']);
  });

  it('rejects an oversized but otherwise ordinary swap', () => {
    const result = run({ ...SWAP, id: 'act_006', valueUsd: 1500 });
    expect(result.allowed).toBe(false);
    // $1,500 breaches both caps at once, and the receipt says so rather than
    // reporting only whichever check happened to run first.
    expect(result.failedChecks).toEqual(['transaction_limit', 'daily_limit']);
  });
});

describe('evaluateAction — individual rules', () => {
  it('treats the per-transaction cap as inclusive', () => {
    expect(run({ ...SWAP, valueUsd: 500 }).allowed).toBe(true);
    expect(run({ ...SWAP, valueUsd: 500.01 }).allowed).toBe(false);
  });

  it('enforces the slippage bound', () => {
    expect(run({ ...SWAP, slippageBps: 100 }).allowed).toBe(true);
    expect(run({ ...SWAP, slippageBps: 101 }).failedChecks).toEqual(['slippage_limit']);
  });

  it('rejects slippage when the policy sets no bound at all', () => {
    const { maxSlippageBps: _drop, ...noSlippage } = POLICY;
    const result = evaluateAction({
      intent: makeIntent(noSlippage),
      action: SWAP,
      now: NOW,
    });
    expect(result.failedChecks).toContain('slippage_limit');
  });

  it('rejects an unapproved target protocol', () => {
    expect(run({ ...SWAP, targetContract: 'APPROVED_LENDING_1' }).failedChecks).toEqual([
      'contract_allowed',
    ]);
  });

  it('rejects an expired authorization', () => {
    const result = run(SWAP, { now: new Date('2026-09-02T12:00:00Z') });
    expect(result.failedChecks).toEqual(['intent_not_expired']);
  });

  it('rejects a revoked authorization', () => {
    const result = evaluateAction({
      intent: makeIntent(POLICY, { revokedAt: '2026-09-01T11:30:00Z' }),
      action: SWAP,
      now: NOW,
    });
    expect(result.failedChecks).toEqual(['intent_not_revoked']);
  });

  it('ignores a revocation that has not happened yet', () => {
    const result = evaluateAction({
      intent: makeIntent(POLICY, { revokedAt: '2026-09-01T13:00:00Z' }),
      action: SWAP,
      now: NOW,
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects an agent the intent does not name', () => {
    const result = run(SWAP, { agentId: 'agent_someone_else' });
    expect(result.failedChecks).toEqual(['agent_authorized']);
  });

  it('detects a policy edited after commitment', () => {
    // The stored canonical bytes are what was committed; mutating the policy
    // object afterwards has to be caught, or the commitment means nothing.
    const intent = makeIntent();
    const tampered: AuthorizedIntent = {
      ...intent,
      policy: { ...POLICY, maxTransactionValueUsd: 50_000 },
    };
    const result = evaluateAction({ intent: tampered, action: { ...SWAP, valueUsd: 40_000 }, now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.failedChecks).toContain('intent_hash_integrity');
  });

  it('rejects an action replayed under the same intent', () => {
    const ledger = applyToLedger(EMPTY_LEDGER, SWAP, NOW);
    const result = run({ ...SWAP, valueUsd: 10 }, { ledger });
    expect(result.failedChecks).toContain('replay_protection');
  });
});

describe('daily budget', () => {
  it('accumulates across actions within a day', () => {
    let ledger = EMPTY_LEDGER;
    for (const id of ['a', 'b']) {
      const action = { ...SWAP, id, valueUsd: 500 };
      expect(evaluateAction({ intent: makeIntent(), action, now: NOW, ledger }).allowed).toBe(true);
      ledger = applyToLedger(ledger, action, NOW);
    }
    const third = evaluateAction({
      intent: makeIntent(),
      action: { ...SWAP, id: 'c', valueUsd: 1 },
      now: NOW,
      ledger,
    });
    expect(third.failedChecks).toEqual(['daily_limit']);
    expect(third.reasons[0]).toContain('$1,000');
  });

  it('resets on the next UTC day, matching the Cairo day index', () => {
    const ledger = applyToLedger(applyToLedger(EMPTY_LEDGER, { ...SWAP, id: 'a', valueUsd: 500 }, NOW), { ...SWAP, id: 'b', valueUsd: 500 }, NOW);
    const nextDay = new Date('2026-09-02T00:00:01Z');
    expect(dayIndex(nextDay)).toBe(dayIndex(NOW) + 1);

    const policy = { ...POLICY, expiresAt: '2026-09-10T00:00:00Z' };
    const result = evaluateAction({
      intent: makeIntent(policy),
      action: { ...SWAP, id: 'c', valueUsd: 500 },
      now: nextDay,
      ledger,
    });
    expect(result.allowed).toBe(true);
  });

  it('counts only allowed actions against the budget', () => {
    // A rejected proposal costs the user nothing, so it must not consume budget.
    const ledger = EMPTY_LEDGER;
    const rejected = evaluateAction({
      intent: makeIntent(),
      action: { ...SWAP, id: 'x', valueUsd: 900 },
      now: NOW,
      ledger,
    });
    expect(rejected.allowed).toBe(false);
    expect(evaluateAction({ intent: makeIntent(), action: SWAP, now: NOW, ledger }).allowed).toBe(
      true,
    );
  });
});
