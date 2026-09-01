import type { ChainAnchor, ExecutionMode, IntentPolicy } from '@intentproof/intent-schema';

/** The registry's view of an intent, as read back from the chain. */
export interface OnChainIntent {
  readonly id: number;
  readonly intentHash: string;
  readonly creator: string;
  readonly version: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number;
  readonly maxTransactionValueUsdCents: bigint;
  readonly maxDailySpendUsdCents: bigint;
  readonly executionCount: number;
  readonly totalSpendUsdCents: bigint;
  readonly exists: boolean;
}

export interface OnChainVerification {
  readonly verified: boolean;
  /** Short-string error code from `contracts/src/errors.cairo`, or `null`. */
  readonly failureCode: string | null;
}

export interface RegisterIntentInput {
  readonly intentHash: string;
  readonly canonical: string;
  readonly policy: IntentPolicy;
  readonly agentAddress?: string;
}

export interface RegistrationResult {
  /** `null` in LOCAL_DEMO mode. There is no other way to get a null anchor. */
  readonly anchor: ChainAnchor | null;
  readonly onChainIntentId: number | null;
}

export interface RecordExecutionInput {
  readonly intentHash: string;
  readonly receiptHash: string;
  readonly actionHash: string;
  readonly valueUsd: number;
}

/**
 * The chain boundary.
 *
 * Two implementations exist and the type is the same for both, which is the
 * point: the demo path and the on-chain path run identical application code, and
 * the only difference a caller can observe is whether `anchor` is `null`. There
 * is no branch anywhere that renders a transaction hash it did not receive from
 * a node.
 */
export interface RegistryClient {
  readonly mode: ExecutionMode;
  readonly network: string;
  readonly contractAddress: string | null;
  /** False for local mode and for read-only chain mode (RPC but no key). */
  readonly canWrite: boolean;
  /** Human-readable account of what this client can and cannot do. */
  readonly description: string;

  registerIntent(input: RegisterIntentInput): Promise<RegistrationResult>;
  revokeIntent(intentHash: string): Promise<ChainAnchor | null>;
  recordExecution(input: RecordExecutionInput): Promise<ChainAnchor | null>;
  getIntent(intentHash: string): Promise<OnChainIntent | null>;
  verifyExecution(intentHash: string, receiptHash: string): Promise<OnChainVerification | null>;
}

/** Raised when a chain client is asked to write but has no signing key. */
export class ReadOnlyRegistryError extends Error {
  constructor(operation: string) {
    super(
      `Cannot ${operation}: this deployment has a Starknet RPC endpoint but no STARKNET_PRIVATE_KEY, so it can read the registry but not write to it.`,
    );
    this.name = 'ReadOnlyRegistryError';
  }
}
