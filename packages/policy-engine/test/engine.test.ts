import { receiptIsIntact, type ExecutionReceipt } from '@intentproof/intent-schema';
import { describe, expect, it } from 'vitest';
import { PolicyEngine, ledgerFromHistory, replayReceipt } from '../src/index.js';
import { NOW, POLICY, SWAP, makeIntent } from './fixtures.js';

const clock = (at: Date) => () => at;

describe('PolicyEngine', () => {
  it('seals a receipt for an allowed action', () => {
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    const { evaluation, receipt } = engine.decide({ action: SWAP });

    expect(evaluation.allowed).toBe(true);
    expect(receipt.policyResult).toBe('ALLOWED');
    expect(receipt.checks).toHaveLength(evaluation.checks.length);
    expect(receiptIsIntact(receipt)).toBe(true);
    expect(receipt.intentHash).toBe(engine.intent.intentHash);
  });

  it('seals a receipt for a rejected action too', () => {
    // A refusal that leaves no record is indistinguishable from an action that
    // was never attempted, and the attempt is the interesting part.
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    const { receipt } = engine.decide({ action: { ...SWAP, valueUsd: 5000 } });

    expect(receipt.policyResult).toBe('REJECTED');
    expect(receiptIsIntact(receipt)).toBe(true);
    expect(receipt.checks.filter((c) => !c.passed).length).toBeGreaterThan(0);
  });

  it('never reports a transaction hash in local mode', () => {
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    const { receipt } = engine.decide({ action: SWAP });
    expect(receipt.transactionHash).toBeNull();
    expect(receipt.mode).toBe('LOCAL_DEMO');
  });

  it('advances the ledger only on allowed actions', () => {
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    engine.decide({ action: { ...SWAP, id: 'ok', valueUsd: 400 } });
    engine.decide({ action: { ...SWAP, id: 'too_big', valueUsd: 5000 } });

    expect(engine.ledger.executedActionIds).toEqual(['ok']);
    expect(Object.values(engine.ledger.spentUsdByDay)).toEqual([400]);
  });

  it('evaluate() does not mutate the ledger', () => {
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    engine.evaluate({ action: SWAP });
    engine.evaluate({ action: SWAP });
    expect(engine.ledger.executedActionIds).toEqual([]);
  });

  it('carries the daily budget across a run', () => {
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    const first = engine.decide({ action: { ...SWAP, id: 'a', valueUsd: 500 } });
    const second = engine.decide({ action: { ...SWAP, id: 'b', valueUsd: 500 } });
    const third = engine.decide({ action: { ...SWAP, id: 'c', valueUsd: 100 } });

    expect(first.evaluation.allowed).toBe(true);
    expect(second.evaluation.allowed).toBe(true);
    expect(third.evaluation.allowed).toBe(false);
    expect(third.evaluation.failedChecks).toEqual(['daily_limit']);
  });

  it('produces distinct receipt hashes for distinct actions', () => {
    const engine = new PolicyEngine(makeIntent(), { clock: clock(NOW) });
    const a = engine.decide({ action: { ...SWAP, id: 'a' } }).receipt;
    const b = engine.decide({ action: { ...SWAP, id: 'b' } }).receipt;
    expect(a.receiptHash).not.toBe(b.receiptHash);
  });
});

describe('replayReceipt', () => {
  const engine = () => new PolicyEngine(makeIntent(), { clock: clock(NOW) });

  it('reproduces an ALLOWED verdict', () => {
    const intent = makeIntent();
    const { receipt } = new PolicyEngine(intent, { clock: clock(NOW) }).decide({ action: SWAP });
    const result = replayReceipt({ intent, receipt });
    expect(result.verified).toBe(true);
  });

  it('reproduces a REJECTED verdict', () => {
    const intent = makeIntent();
    const { receipt } = new PolicyEngine(intent, { clock: clock(NOW) }).decide({
      action: { ...SWAP, valueUsd: 9000 },
    });
    const result = replayReceipt({ intent, receipt });
    expect(result.verified).toBe(true);
    expect(receipt.policyResult).toBe('REJECTED');
  });

  it('catches a receipt whose verdict was flipped', () => {
    const intent = makeIntent();
    const { receipt } = new PolicyEngine(intent, { clock: clock(NOW) }).decide({
      action: { ...SWAP, valueUsd: 9000 },
    });
    const forged: ExecutionReceipt = { ...receipt, policyResult: 'ALLOWED' };

    const result = replayReceipt({ intent, receipt: forged });
    expect(result.verified).toBe(false);
    expect(result.findings.find((f) => f.name === 'receipt_integrity')?.passed).toBe(false);
    expect(result.findings.find((f) => f.name === 'policy_evaluation')?.passed).toBe(false);
  });

  it('catches a receipt whose action was swapped after sealing', () => {
    const intent = makeIntent();
    const { receipt } = new PolicyEngine(intent, { clock: clock(NOW) }).decide({ action: SWAP });
    const forged: ExecutionReceipt = {
      ...receipt,
      action: { ...receipt.action, valueUsd: 40_000 },
    };
    const result = replayReceipt({ intent, receipt: forged });
    expect(result.findings.find((f) => f.name === 'action_integrity')?.passed).toBe(false);
  });

  it('catches a receipt bound to a different intent', () => {
    const intent = makeIntent();
    const other = makeIntent({ ...POLICY, purpose: 'yield_farming' });
    const { receipt } = new PolicyEngine(other, { clock: clock(NOW) }).decide({ action: SWAP });
    const result = replayReceipt({ intent, receipt });
    expect(result.findings.find((f) => f.name === 'intent_binding')?.passed).toBe(false);
  });

  it('catches a check list that was quietly edited to all-pass', () => {
    const intent = makeIntent();
    const { receipt } = new PolicyEngine(intent, { clock: clock(NOW) }).decide({
      action: { ...SWAP, valueUsd: 9000 },
    });
    const forged: ExecutionReceipt = {
      ...receipt,
      checks: receipt.checks.map((c) => ({ ...c, passed: true })),
    };
    const result = replayReceipt({ intent, receipt: forged });
    expect(result.findings.find((f) => f.name === 'check_agreement')?.passed).toBe(false);
  });

  it('rebuilds the ledger from history so a replay sees the same budget', () => {
    const intent = makeIntent();
    const live = new PolicyEngine(intent, { clock: clock(NOW) });
    // Each of these is inside the $500 per-transaction cap; together they use up
    // the $1,000 daily budget, so only the third is a purely stateful rejection.
    const first = live.decide({ action: { ...SWAP, id: 'a', valueUsd: 500 } }).receipt;
    const second = live.decide({ action: { ...SWAP, id: 'b', valueUsd: 500 } }).receipt;
    const third = live.decide({ action: { ...SWAP, id: 'c', valueUsd: 100 } }).receipt;

    expect(third.policyResult).toBe('REJECTED');

    // Replaying the third receipt with an empty ledger wrongly allows it: the
    // budget it exhausted is invisible without the history.
    const naive = replayReceipt({ intent, receipt: third });
    expect(naive.verified).toBe(false);
    expect(naive.findings.find((f) => f.name === 'policy_evaluation')?.passed).toBe(false);

    const informed = replayReceipt({
      intent,
      receipt: third,
      ledgerBefore: ledgerFromHistory([first, second]),
    });
    expect(informed.verified).toBe(true);
  });

  it('engine() helper stays unused-safe', () => {
    expect(engine().intent.agentId).toBe('agent_demo_001');
  });
});
