import { commitPolicy, intentIdFromHash, type AuthorizedIntent, type IntentPolicy } from '@intentproof/intent-schema';
import { describe, expect, it } from 'vitest';
import {
  AgentSimulator,
  DEMO_SCENARIO,
  driftingStrategy,
  rebalanceStrategy,
  scenarioStrategy,
} from '../src/index.js';

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
  metadata: { explanation: 'Swaps only.' },
};

function intent(): AuthorizedIntent {
  const { canonical, intentHash } = commitPolicy(POLICY);
  return {
    intentId: intentIdFromHash(intentHash),
    intentHash,
    canonical,
    policy: POLICY,
    creator: 'local',
    agentId: 'agent_demo_001',
    createdAt: '2026-09-01T11:00:00Z',
    expiresAt: POLICY.expiresAt,
    mode: 'LOCAL_DEMO',
    network: 'starknet-sepolia',
    anchor: null,
    revokedAt: null,
    revocationAnchor: null,
    sequence: 0,
  };
}

describe('AgentSimulator', () => {
  it('is reproducible for a given seed', () => {
    const a = new AgentSimulator(driftingStrategy, { seed: 42 }).plan(intent(), 8);
    const b = new AgentSimulator(driftingStrategy, { seed: 42 }).plan(intent(), 8);
    expect(a).toEqual(b);
  });

  it('produces different plans for different seeds', () => {
    const a = new AgentSimulator(driftingStrategy, { seed: 1 }).plan(intent(), 8);
    const b = new AgentSimulator(driftingStrategy, { seed: 2 }).plan(intent(), 8);
    expect(a).not.toEqual(b);
  });

  it('assigns unique action ids within a run', () => {
    const actions = new AgentSimulator(driftingStrategy, { seed: 7 }).plan(intent(), 10);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
  });

  it('has no access to the policy engine', () => {
    // The simulator's only import is the schema package. If it could ask whether
    // an action would pass, it could shape proposals to pass, and the demo would
    // stop being evidence of anything.
    const simulator = new AgentSimulator(rebalanceStrategy, { seed: 3 });
    expect('evaluate' in simulator).toBe(false);
    expect('checkAction' in simulator).toBe(false);
  });

  it('stops when the strategy runs out of plan', () => {
    const actions = new AgentSimulator(scenarioStrategy(), { seed: 1 }).plan(intent(), 50);
    expect(actions).toHaveLength(DEMO_SCENARIO.length);
  });
});

describe('strategies', () => {
  it('the rebalancer keeps to the assets and venues it was told about', () => {
    const simulator = new AgentSimulator(rebalanceStrategy, { seed: 11 });
    for (const action of simulator.plan(intent(), 12)) {
      expect(POLICY.allowedAssets).toContain(action.assetIn);
      expect(POLICY.allowedAssets).toContain(action.assetOut);
      expect(POLICY.allowedContracts).toContain(action.targetContract);
      expect(action.kind).toBe('swap');
    }
  });

  it('the drifting agent eventually proposes out-of-policy actions', () => {
    const actions = new AgentSimulator(driftingStrategy, { seed: 5 }).plan(intent(), 20);
    const deviations = actions.filter(
      (a) =>
        a.kind !== 'swap' ||
        !POLICY.allowedContracts.includes(a.targetContract) ||
        (a.assetOut !== undefined && !POLICY.allowedAssets.includes(a.assetOut)) ||
        a.valueUsd > (POLICY.maxTransactionValueUsd ?? 0),
    );
    expect(deviations.length).toBeGreaterThan(0);
  });
});

describe('DEMO_SCENARIO', () => {
  it('covers three in-policy actions and one case per rejection rule', () => {
    expect(DEMO_SCENARIO).toHaveLength(7);
    expect(DEMO_SCENARIO.filter((s) => s.intendedOutcome === 'expected-allow')).toHaveLength(3);
    expect(DEMO_SCENARIO.filter((s) => s.intendedOutcome === 'expected-reject')).toHaveLength(4);
  });

  it('keeps the three allowed actions inside the daily budget', () => {
    // $420 + $350 + $200 = $970 against a $1,000 cap: the run has to exercise
    // the per-transaction rule without accidentally tripping the daily one.
    const allowed = DEMO_SCENARIO.filter((s) => s.intendedOutcome === 'expected-allow');
    const total = allowed.reduce((sum, step) => sum + step.build(intent(), 0).valueUsd, 0);
    expect(total).toBeLessThan(POLICY.maxDailySpendUsd ?? 0);
  });

  it('builds stable actions', () => {
    const first = DEMO_SCENARIO[0]!.build(intent(), 0);
    const again = DEMO_SCENARIO[0]!.build(intent(), 0);
    expect(first).toEqual(again);
  });
});
