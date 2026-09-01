import { z } from 'zod';
import { ActionKindSchema, AssetSymbolSchema, ContractIdSchema } from './actions.js';
import { INTENT_POLICY_VERSION, MAX_SLIPPAGE_BPS } from './constants.js';

const UsdAmountSchema = z
  .number()
  .finite()
  .positive()
  .max(1_000_000_000)
  .describe('US dollars');

const IsoTimestampSchema = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 timestamp');

const MetadataSchema = z
  .object({
    /**
     * The model's own account of what it understood. Shown to the user and
     * included in the commitment, because it is part of what they approved.
     */
    explanation: z.string().min(1).max(2000),
  })
  .strict();

/**
 * The authorization document.
 *
 * This is the only thing the policy engine reads and the only thing the
 * commitment covers. It contains no prose the engine interprets: every field is
 * either an enum, a number or a list of identifiers.
 */
export const IntentPolicySchema = z
  .object({
    version: z.literal(INTENT_POLICY_VERSION),
    purpose: z.string().trim().min(3).max(120),
    allowedActions: z.array(ActionKindSchema).min(1).max(16),
    forbiddenActions: z.array(ActionKindSchema).max(16),
    allowedAssets: z.array(AssetSymbolSchema).min(1).max(32),
    allowedContracts: z.array(ContractIdSchema).min(1).max(32),
    /**
     * Recipients for value-exfiltrating actions. Absent or empty means no
     * transfers are authorized at all — the safe reading of silence.
     */
    allowedDestinations: z.array(ContractIdSchema).max(32).optional(),
    maxTransactionValueUsd: UsdAmountSchema.optional(),
    maxDailySpendUsd: UsdAmountSchema.optional(),
    maxSlippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).optional(),
    expiresAt: IsoTimestampSchema,
    metadata: MetadataSchema.optional(),
  })
  .strict();

export type IntentPolicy = z.infer<typeof IntentPolicySchema>;

/**
 * The model-facing shape.
 *
 * OpenAI structured outputs run in strict mode, where every property must be
 * required and `additionalProperties` must be false. Optional fields are
 * therefore expressed as explicitly nullable and normalized afterwards — the
 * model is never given the option of silently omitting a limit.
 *
 * `version` is absent on purpose: the schema version is ours to set, not the
 * model's to choose.
 */
export const IntentProposalSchema = z
  .object({
    purpose: z.string(),
    allowedActions: z.array(ActionKindSchema),
    forbiddenActions: z.array(ActionKindSchema),
    allowedAssets: z.array(z.string()),
    allowedContracts: z.array(z.string()),
    allowedDestinations: z.array(z.string()).nullable(),
    maxTransactionValueUsd: z.number().nullable(),
    maxDailySpendUsd: z.number().nullable(),
    maxSlippageBps: z.number().int().nullable(),
    /** Relative, not absolute: models are unreliable at "now". */
    durationHours: z.number(),
    explanation: z.string(),
  })
  .strict();

export type IntentProposal = z.infer<typeof IntentProposalSchema>;

/** Normalization applied before hashing so trivial spelling differences collapse. */
export function normalizePolicy(policy: IntentPolicy): IntentPolicy {
  const uniqueSorted = (values: readonly string[], transform: (v: string) => string): string[] =>
    [...new Set(values.map((v) => transform(v.trim())))].sort();

  const normalized: IntentPolicy = {
    version: policy.version,
    purpose: policy.purpose.trim().toLowerCase().replace(/\s+/gu, '_'),
    allowedActions: uniqueSorted(policy.allowedActions, (v) => v.toLowerCase()) as
      IntentPolicy['allowedActions'],
    forbiddenActions: uniqueSorted(policy.forbiddenActions, (v) => v.toLowerCase()) as
      IntentPolicy['forbiddenActions'],
    allowedAssets: uniqueSorted(policy.allowedAssets, (v) => v.toUpperCase()),
    allowedContracts: uniqueSorted(policy.allowedContracts, (v) =>
      v.startsWith('0x') ? v.toLowerCase() : v.toUpperCase(),
    ),
    expiresAt: new Date(policy.expiresAt).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
  };

  if (policy.allowedDestinations && policy.allowedDestinations.length > 0) {
    normalized.allowedDestinations = uniqueSorted(policy.allowedDestinations, (v) =>
      v.startsWith('0x') ? v.toLowerCase() : v.toUpperCase(),
    );
  }
  if (policy.maxTransactionValueUsd !== undefined) {
    normalized.maxTransactionValueUsd = policy.maxTransactionValueUsd;
  }
  if (policy.maxDailySpendUsd !== undefined) {
    normalized.maxDailySpendUsd = policy.maxDailySpendUsd;
  }
  if (policy.maxSlippageBps !== undefined) {
    normalized.maxSlippageBps = policy.maxSlippageBps;
  }
  if (policy.metadata) {
    normalized.metadata = { explanation: policy.metadata.explanation.trim() };
  }
  return normalized;
}
