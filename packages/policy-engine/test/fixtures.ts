import {
  commitPolicy,
  intentIdFromHash,
  type AgentAction,
  type AuthorizedIntent,
  type IntentPolicy,
} from '@intentproof/intent-schema';

export const NOW = new Date('2026-09-01T12:00:00Z');

export const POLICY: IntentPolicy = {
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

export function makeIntent(
  policy: IntentPolicy = POLICY,
  overrides: Partial<AuthorizedIntent> = {},
): AuthorizedIntent {
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

export const SWAP: AgentAction = {
  id: 'act_001',
  kind: 'swap',
  assetIn: 'ETH',
  assetOut: 'STRK',
  valueUsd: 420,
  slippageBps: 60,
  targetContract: 'APPROVED_DEX_1',
};
