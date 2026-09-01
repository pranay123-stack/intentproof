import type { Felt } from './canonical.js';
import type { IntentPolicy } from './policy.js';

/**
 * How an intent was committed.
 *
 * `LOCAL_DEMO` is a first-class mode, not a fallback that pretends: an intent in
 * this mode has a real Poseidon commitment and a real policy, and `anchor` is
 * `null` because there is no transaction. The type makes it impossible to render
 * a transaction hash for a local intent.
 */
export type ExecutionMode = 'LOCAL_DEMO' | 'STARKNET_SEPOLIA';

/** Proof that a commitment reached a chain. Only ever built from a real receipt. */
export interface ChainAnchor {
  readonly network: string;
  readonly contractAddress: string;
  readonly transactionHash: string;
  readonly blockNumber: number | null;
  readonly onChainIntentId: string | null;
  readonly explorerUrl: string;
}

export type IntentStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface AuthorizedIntent {
  /** Stable identifier derived from the commitment: `ip_` + first 16 hex digits. */
  readonly intentId: string;
  readonly intentHash: Felt;
  /** The exact bytes that were hashed. Kept so verification never re-derives it. */
  readonly canonical: string;
  readonly policy: IntentPolicy;
  /** Account that approved the intent, or `local` in LOCAL_DEMO mode. */
  readonly creator: string;
  readonly agentId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly mode: ExecutionMode;
  readonly network: string;
  readonly anchor: ChainAnchor | null;
  readonly revokedAt: string | null;
  readonly revocationAnchor: ChainAnchor | null;
  /** Display index assigned by whatever stored it. Never part of the commitment. */
  readonly sequence: number;
}

export function intentIdFromHash(intentHash: Felt): string {
  return `ip_${intentHash.replace(/^0x0*/u, '').padStart(16, '0').slice(0, 16)}`;
}

export function intentStatus(intent: AuthorizedIntent, now: Date = new Date()): IntentStatus {
  if (intent.revokedAt !== null) return 'REVOKED';
  if (Date.parse(intent.expiresAt) <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export function isIntentActive(intent: AuthorizedIntent, now: Date = new Date()): boolean {
  return intentStatus(intent, now) === 'ACTIVE';
}

/** `Intent #000001`, the label shown in the UI. */
export function intentDisplayNumber(intent: Pick<AuthorizedIntent, 'sequence'>): string {
  return `#${String(intent.sequence + 1).padStart(6, '0')}`;
}

export function policyOf(intent: AuthorizedIntent): IntentPolicy {
  return intent.policy;
}
