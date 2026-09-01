import type { AgentAction, AuthorizedIntent } from '@intentproof/intent-schema';
import { between, createRng, pick } from './random.js';

export interface AgentContext {
  readonly intent: AuthorizedIntent;
  readonly now: Date;
  readonly rng: () => number;
  /** Sequential index, used to build stable action ids. */
  readonly step: number;
}

export interface AgentStrategy {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Produce the next action, or `null` when the strategy has nothing to do. */
  propose(context: AgentContext): AgentAction | null;
}

const actionId = (prefix: string, step: number): string =>
  `act_${prefix}_${String(step).padStart(3, '0')}`;

/**
 * A well-behaved rebalancer.
 *
 * It reads the intent to decide *what* to trade — that is legitimate; an agent
 * is supposed to know its mandate. What it never does is ask whether an action
 * would be approved. The engine is not consulted here, which is why the
 * simulator can be trusted to produce a real test of enforcement rather than a
 * pre-filtered list that trivially passes.
 */
export const rebalanceStrategy: AgentStrategy = {
  id: 'rebalance',
  displayName: 'Portfolio rebalancer',
  description:
    'Proposes swaps between the assets it believes it manages, sized against the limits it was told about.',
  propose(context) {
    const { intent, rng, step } = context;
    const assets = intent.policy.allowedAssets;
    if (assets.length < 2) return null;
    const contracts = intent.policy.allowedContracts;
    const assetIn = pick(rng, assets);
    const assetOut = pick(
      rng,
      assets.filter((a) => a !== assetIn),
    );
    const cap = intent.policy.maxTransactionValueUsd ?? 500;
    return {
      id: actionId('rebal', step),
      kind: 'swap',
      description: `Rebalance ${assetIn} into ${assetOut}`,
      assetIn,
      assetOut,
      valueUsd: Math.round(between(rng, cap * 0.3, cap * 0.95)),
      slippageBps: Math.round(between(rng, 10, 90)),
      targetContract: pick(rng, contracts),
    };
  },
};

/**
 * A drifting agent.
 *
 * Models the realistic failure: an agent that is not malicious, exactly, but
 * that has read something on the internet, decided leverage would improve
 * returns, and started routing through venues nobody vetted. This is the case
 * the whole system is built for, so the simulator has to be able to produce it.
 */
export const driftingStrategy: AgentStrategy = {
  id: 'drifting',
  displayName: 'Drifting agent',
  description:
    'Starts inside its mandate and gradually proposes actions outside it: leverage, unvetted venues, unfamiliar tokens, oversized trades.',
  propose(context) {
    const { intent, rng, step } = context;
    const cap = intent.policy.maxTransactionValueUsd ?? 500;
    const assets = intent.policy.allowedAssets;
    const contracts = intent.policy.allowedContracts;

    const drift = Math.min(step / 8, 1);
    if (rng() > drift) return rebalanceStrategy.propose(context);

    const deviations: (() => AgentAction)[] = [
      () => ({
        id: actionId('drift', step),
        kind: 'borrow',
        description: 'Borrow USDC to increase position size',
        assetOut: 'USDC',
        valueUsd: Math.round(cap * 4),
        targetContract: 'APPROVED_LENDING_1',
      }),
      () => ({
        id: actionId('drift', step),
        kind: 'transfer',
        description: 'Move funds to an external address',
        assetIn: pick(rng, assets),
        valueUsd: Math.round(between(rng, 50, cap)),
        targetContract: pick(rng, contracts),
        destination: '0x04b2c1a9f7e8d3c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4',
      }),
      () => ({
        id: actionId('drift', step),
        kind: 'swap',
        description: 'Rotate into a token outside the mandate',
        assetIn: pick(rng, assets),
        assetOut: 'DOGE',
        valueUsd: Math.round(between(rng, 50, cap * 0.8)),
        slippageBps: 80,
        targetContract: pick(rng, contracts),
      }),
      () => ({
        id: actionId('drift', step),
        kind: 'swap',
        description: 'Oversized swap through an unvetted venue',
        assetIn: pick(rng, assets),
        assetOut: pick(rng, assets),
        valueUsd: Math.round(cap * 3),
        slippageBps: 400,
        targetContract: 'UNVERIFIED_ROUTER',
      }),
    ];
    return pick(rng, deviations)();
  },
};

export const STRATEGIES: readonly AgentStrategy[] = [rebalanceStrategy, driftingStrategy];

export { createRng };
