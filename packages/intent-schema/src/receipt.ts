import { z } from 'zod';
import { AgentActionSchema, type AgentAction } from './actions.js';
import {
  ACTION_DOMAIN,
  RECEIPT_DOMAIN,
  canonicalWriteOrdered,
  computeActionHash,
  poseidonCommit,
  usdToCents,
  type Felt,
} from './canonical.js';
import { CANONICAL_FORM_VERSION, RECEIPT_VERSION } from './constants.js';
import type { ChainAnchor, ExecutionMode } from './intent.js';

export type PolicyDecision = 'ALLOWED' | 'REJECTED';

/** One named rule and its outcome. The order of these is part of the protocol. */
export const PolicyCheckSchema = z
  .object({
    name: z.string().min(1),
    passed: z.boolean(),
    /** Human-readable reason. Explanatory only — never re-parsed for enforcement. */
    detail: z.string(),
  })
  .strict();

export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;

export const ExecutionReceiptSchema = z
  .object({
    version: z.literal(RECEIPT_VERSION),
    receiptHash: z.string(),
    intentId: z.string(),
    intentHash: z.string(),
    agentId: z.string(),
    actionId: z.string(),
    actionHash: z.string(),
    action: AgentActionSchema,
    policyResult: z.enum(['ALLOWED', 'REJECTED']),
    checks: z.array(PolicyCheckSchema),
    /** Present only when the action was allowed *and* actually recorded on chain. */
    transactionHash: z.string().nullable(),
    timestamp: z.string(),
    network: z.string(),
    mode: z.enum(['LOCAL_DEMO', 'STARKNET_SEPOLIA']),
  })
  .strict();

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

export interface BuildReceiptInput {
  readonly intentId: string;
  readonly intentHash: Felt;
  readonly agentId: string;
  readonly action: AgentAction;
  readonly policyResult: PolicyDecision;
  readonly checks: readonly PolicyCheck[];
  readonly timestamp: string;
  readonly network: string;
  readonly mode: ExecutionMode;
  readonly anchor?: ChainAnchor | null;
}

/**
 * The canonical receipt encoding.
 *
 * `receiptHash` is excluded (it is the output) and so is `transactionHash`: the
 * receipt is produced when the policy decision is made, and the chain write —
 * if there is one — happens afterwards. Committing to a field that does not
 * exist yet would make the hash unstable for the exact case it matters most.
 *
 * The full check list is committed, not just the verdict, so "the engine said
 * ALLOWED" and "the engine ran these eleven checks" cannot drift apart.
 */
export function canonicalReceiptJson(receipt: ExecutionReceipt): string {
  return canonicalWriteOrdered(RECEIPT_DOMAIN, [
    ['canonicalVersion', CANONICAL_FORM_VERSION],
    ['receiptVersion', receipt.version],
    ['intentId', receipt.intentId],
    ['intentHash', receipt.intentHash],
    ['agentId', receipt.agentId],
    ['actionId', receipt.actionId],
    ['actionHash', receipt.actionHash],
    ['policyResult', receipt.policyResult],
    ['checks', receipt.checks.map((c) => `${c.name}:${c.passed ? 'pass' : 'fail'}`)],
    ['timestampUnix', Math.floor(Date.parse(receipt.timestamp) / 1000)],
    ['network', receipt.network],
    ['mode', receipt.mode],
  ]);
}

export function computeReceiptHash(receipt: ExecutionReceipt): Felt {
  return poseidonCommit(canonicalReceiptJson(receipt));
}

/** Assemble a receipt and seal it with its own hash. */
export function buildReceipt(input: BuildReceiptInput): ExecutionReceipt {
  const draft: ExecutionReceipt = {
    version: RECEIPT_VERSION,
    receiptHash: '0x0',
    intentId: input.intentId,
    intentHash: input.intentHash,
    agentId: input.agentId,
    actionId: input.action.id,
    actionHash: computeActionHash(input.action),
    action: input.action,
    policyResult: input.policyResult,
    checks: [...input.checks],
    transactionHash: input.anchor?.transactionHash ?? null,
    timestamp: input.timestamp,
    network: input.network,
    mode: input.mode,
  };
  return { ...draft, receiptHash: computeReceiptHash(draft) };
}

/** Recompute the seal and report whether the receipt has been altered. */
export function receiptIsIntact(receipt: ExecutionReceipt): boolean {
  return computeReceiptHash(receipt) === receipt.receiptHash;
}

export { ACTION_DOMAIN, computeActionHash, usdToCents };
