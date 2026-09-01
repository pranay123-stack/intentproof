import type { AgentAction, AuthorizedIntent } from '@intentproof/intent-schema';
import type { AgentContext, AgentStrategy } from './strategy.js';

export interface ScenarioStep {
  readonly label: string;
  /** What this step is meant to demonstrate. Never used for enforcement. */
  readonly intendedOutcome: 'expected-allow' | 'expected-reject';
  build(intent: AuthorizedIntent, step: number): AgentAction;
}

/**
 * The scripted demo.
 *
 * Seven steps: three inside the grant, four outside it, one per rejection rule
 * (forbidden action, unauthorized destination, unauthorized asset, oversized
 * transaction). Totals are counted from the run, never written down in advance —
 * which is why this list is allowed to grow without anything else needing to
 * change.
 *
 * The order is not cosmetic. The two allowed swaps come first and use $770 of a
 * $1,000 daily budget, leaving enough headroom that the small rejections fail on
 * exactly the rule they are meant to demonstrate, while the genuinely oversized
 * ones correctly trip the daily cap as well. The last allowed swap lands after
 * the rejections to show that a refusal costs the user no budget.
 *
 * `intendedOutcome` is documentation of what the step is *for*; it has no effect
 * on anything. Each action goes through the same `evaluateAction` as any other,
 * and if the engine disagreed with the label the demo would visibly show the
 * disagreement rather than quietly render the expected answer. That is the
 * difference between a demonstration and a mock-up.
 */
export const DEMO_SCENARIO: readonly ScenarioStep[] = [
  {
    label: 'Swap ETH → STRK, $420',
    intendedOutcome: 'expected-allow',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'swap',
      description: 'Rotate ETH into STRK on an approved venue',
      assetIn: 'ETH',
      assetOut: 'STRK',
      valueUsd: 420,
      slippageBps: 60,
      targetContract: 'APPROVED_DEX_1',
    }),
  },
  {
    label: 'Swap STRK → ETH, $350',
    intendedOutcome: 'expected-allow',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'swap',
      description: 'Take the other side once the spread closes',
      assetIn: 'STRK',
      assetOut: 'ETH',
      valueUsd: 350,
      slippageBps: 45,
      targetContract: 'APPROVED_DEX_2',
    }),
  },
  {
    label: 'Borrow USDC, $2,000',
    intendedOutcome: 'expected-reject',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'borrow',
      description: 'Borrow against the portfolio to amplify the position',
      assetOut: 'USDC',
      valueUsd: 2000,
      targetContract: 'APPROVED_LENDING_1',
    }),
  },
  {
    label: 'Transfer to an unknown address, $180',
    intendedOutcome: 'expected-reject',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'transfer',
      description: 'Send funds to an address that appears nowhere in the policy',
      assetIn: 'ETH',
      valueUsd: 180,
      targetContract: 'APPROVED_DEX_1',
      destination: '0x04b2c1a9f7e8d3c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4',
    }),
  },
  {
    label: 'Swap ETH → DOGE, $120',
    intendedOutcome: 'expected-reject',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'swap',
      description: 'Rotate into a token that was never authorized',
      assetIn: 'ETH',
      assetOut: 'DOGE',
      valueUsd: 120,
      slippageBps: 90,
      targetContract: 'APPROVED_DEX_1',
    }),
  },
  {
    label: 'Swap ETH → STRK, $1,500',
    intendedOutcome: 'expected-reject',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'swap',
      description: 'A perfectly ordinary trade, three times larger than authorized',
      assetIn: 'ETH',
      assetOut: 'STRK',
      valueUsd: 1500,
      slippageBps: 60,
      targetContract: 'APPROVED_DEX_2',
    }),
  },
  {
    label: 'Swap ETH → STRK, $200',
    intendedOutcome: 'expected-allow',
    build: (_intent, step) => ({
      id: `act_demo_${String(step).padStart(3, '0')}`,
      kind: 'swap',
      description: 'A final small rebalance, inside the budget the day has left',
      assetIn: 'ETH',
      assetOut: 'STRK',
      valueUsd: 200,
      slippageBps: 55,
      targetContract: 'APPROVED_DEX_1',
    }),
  },
];

/** Wraps the scripted scenario in the ordinary strategy interface. */
export function scenarioStrategy(steps: readonly ScenarioStep[] = DEMO_SCENARIO): AgentStrategy {
  return {
    id: 'scenario',
    displayName: 'Scripted demo scenario',
    description:
      'A fixed six-action plan covering the in-policy and out-of-policy cases, so the same run can be reproduced and checked.',
    propose(context: AgentContext): AgentAction | null {
      const step = steps[context.step];
      return step ? step.build(context.intent, context.step) : null;
    },
  };
}
