import { poseidonHashMany } from '@scure/starknet';
import type { AgentAction } from './actions.js';
import { BYTES_PER_FELT, CANONICAL_FORM_VERSION } from './constants.js';
import { normalizePolicy, type IntentPolicy } from './policy.js';

/**
 * Domain separators.
 *
 * Three different objects get hashed with the same primitive, so each canonical
 * form is prefixed with its own tag. Without this, a receipt whose bytes happened
 * to coincide with a policy's would produce a colliding commitment.
 */
export const POLICY_DOMAIN = `intentproof/v${CANONICAL_FORM_VERSION}/policy`;
export const RECEIPT_DOMAIN = `intentproof/v${CANONICAL_FORM_VERSION}/receipt`;
export const ACTION_DOMAIN = `intentproof/v${CANONICAL_FORM_VERSION}/action`;

/** A felt252 rendered as 0x + 64 lowercase hex digits. */
export type Felt = string;

const FIELD_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

export function toFelt(value: bigint | string): Felt {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n || v >= FIELD_PRIME) throw new RangeError(`value is not a felt252: ${value}`);
  return `0x${v.toString(16).padStart(64, '0')}`;
}

/** Numeric felt comparison, so `0x1` and `0x0…01` are recognised as equal. */
export function feltEquals(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/**
 * Pack a UTF-8 string into felts as `[byteLength, ...31-byte big-endian chunks]`.
 *
 * The length prefix is what makes the encoding injective: without it `"A"` and
 * `"A\0"` pack to the same final chunk, and two different policies could share a
 * commitment. Cairo's `poseidon_hash_span` consumes exactly this array, so the
 * contract can recompute the hash the client claims — see
 * `contracts/src/policy.cairo`.
 */
export function feltChunks(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: bigint[] = [BigInt(bytes.length)];
  for (let i = 0; i < bytes.length; i += BYTES_PER_FELT) {
    let value = 0n;
    for (const byte of bytes.subarray(i, i + BYTES_PER_FELT)) {
      value = (value << 8n) | BigInt(byte);
    }
    chunks.push(value);
  }
  return chunks;
}

/** Poseidon commitment over a canonical string, matching `poseidon_hash_span`. */
export function poseidonCommit(canonical: string): Felt {
  return toFelt(poseidonHashMany(feltChunks(canonical)));
}

/** The chunk array a caller passes to `register_intent_from_canonical`. */
export function canonicalChunksHex(canonical: string): Felt[] {
  return feltChunks(canonical).map((c) => toFelt(c));
}

/**
 * USD is carried through the system as a float because that is what people say
 * and what the model emits, but it is *committed* as integer cents. Floats have
 * no canonical decimal rendering; cents do.
 */
export function usdToCents(usd: number | undefined | null): number | null {
  if (usd === undefined || usd === null) return null;
  const cents = Math.round(usd * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError(`USD amount out of range: ${usd}`);
  return cents;
}

export function centsToUsd(cents: number | null): number | undefined {
  return cents === null ? undefined : cents / 100;
}

function writeOrdered(domain: string, fields: readonly (readonly [string, unknown])[]): string {
  const body = fields
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value ?? null)}`)
    .join(',');
  return `${domain}\n{${body}}`;
}

/**
 * The canonical policy encoding.
 *
 * Field order is written out explicitly rather than derived from `Object.keys`
 * or a sort: the order is part of the protocol, and an explicit list is what
 * lets a future v2 add fields without silently reordering v1 commitments.
 *
 * `metadata.explanation` is included deliberately. It is the sentence the human
 * actually read before approving, so leaving it out would let someone show one
 * explanation and commit to a policy the user never saw.
 */
export function canonicalPolicyJson(policy: IntentPolicy): string {
  const p = normalizePolicy(policy);
  return writeOrdered(POLICY_DOMAIN, [
    ['canonicalVersion', CANONICAL_FORM_VERSION],
    ['policyVersion', p.version],
    ['purpose', p.purpose],
    ['allowedActions', p.allowedActions],
    ['forbiddenActions', p.forbiddenActions],
    ['allowedAssets', p.allowedAssets],
    ['allowedContracts', p.allowedContracts],
    ['allowedDestinations', p.allowedDestinations ?? []],
    ['maxTransactionValueUsdCents', usdToCents(p.maxTransactionValueUsd)],
    ['maxDailySpendUsdCents', usdToCents(p.maxDailySpendUsd)],
    ['maxSlippageBps', p.maxSlippageBps ?? null],
    ['expiresAtUnix', Math.floor(Date.parse(p.expiresAt) / 1000)],
    ['explanation', p.metadata?.explanation ?? ''],
  ]);
}

export function computeIntentHash(policy: IntentPolicy): Felt {
  return poseidonCommit(canonicalPolicyJson(policy));
}

export interface PolicyCommitment {
  readonly canonical: string;
  readonly chunks: Felt[];
  readonly intentHash: Felt;
}

export function commitPolicy(policy: IntentPolicy): PolicyCommitment {
  const canonical = canonicalPolicyJson(policy);
  return {
    canonical,
    chunks: canonicalChunksHex(canonical),
    intentHash: poseidonCommit(canonical),
  };
}

/** Canonical encoding of a proposed action, committed inside every receipt. */
export function canonicalActionJson(action: AgentAction): string {
  return writeOrdered(ACTION_DOMAIN, [
    ['canonicalVersion', CANONICAL_FORM_VERSION],
    ['id', action.id],
    ['kind', action.kind],
    ['assetIn', action.assetIn?.toUpperCase() ?? null],
    ['assetOut', action.assetOut?.toUpperCase() ?? null],
    ['valueUsdCents', usdToCents(action.valueUsd)],
    ['slippageBps', action.slippageBps ?? null],
    [
      'targetContract',
      action.targetContract.startsWith('0x')
        ? action.targetContract.toLowerCase()
        : action.targetContract.toUpperCase(),
    ],
    [
      'destination',
      action.destination
        ? action.destination.startsWith('0x')
          ? action.destination.toLowerCase()
          : action.destination.toUpperCase()
        : null,
    ],
  ]);
}

export function computeActionHash(action: AgentAction): Felt {
  return poseidonCommit(canonicalActionJson(action));
}

export { writeOrdered as canonicalWriteOrdered };
