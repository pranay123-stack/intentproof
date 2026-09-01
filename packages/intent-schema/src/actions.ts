import { z } from 'zod';

/**
 * The closed set of action kinds IntentProof understands.
 *
 * It is closed on purpose. If the model could invent an action name, an
 * allowlist would be meaningless — "allowed: [transfer_but_safe]" would sail
 * past every check. Anything outside this set fails schema validation and no
 * intent is created.
 */
export const ACTION_KINDS = [
  'swap',
  'transfer',
  'approve',
  'stake',
  'unstake',
  'provide_liquidity',
  'remove_liquidity',
  'claim_rewards',
  'bridge',
  'borrow',
  'repay',
  'leverage',
  'short',
  'liquidate',
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export const ActionKindSchema = z.enum(ACTION_KINDS);

/**
 * Action kinds that move value out of the user's control to a third party.
 * These require an explicit destination allowlist, never a bare "allowed".
 */
export const VALUE_EXFILTRATING_ACTIONS: readonly ActionKind[] = ['transfer', 'bridge'];

/**
 * Action kinds that create debt or directional exposure. Natural language like
 * "never use leverage" has to map onto a concrete set, and this is it.
 */
export const LEVERAGE_ACTIONS: readonly ActionKind[] = ['borrow', 'leverage', 'short'];

/** An asset symbol. Uppercased on normalization so "eth" and "ETH" are one asset. */
export const AssetSymbolSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/u, 'asset symbols are alphanumeric, starting with a letter');

/**
 * A protocol identifier: either a directory label (`APPROVED_DEX_1`) or a
 * literal Starknet address. Labels are resolved through the protocol directory
 * at evaluation time; unresolvable labels are a rejection, not a warning.
 */
export const ContractIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(
    /^(0x[0-9a-fA-F]{1,64}|[A-Za-z][A-Za-z0-9_]*)$/u,
    'contract ids are Starknet addresses or directory labels',
  );

/** A proposed action, as produced by an agent and handed to the policy engine. */
export const AgentActionSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: ActionKindSchema,
    /** Human-readable one-liner, shown in the UI. Never used for enforcement. */
    description: z.string().max(240).optional(),
    /** Asset leaving the account (swap in, transfer out, stake). */
    assetIn: AssetSymbolSchema.optional(),
    /** Asset arriving (swap out, unstake). */
    assetOut: AssetSymbolSchema.optional(),
    /** Notional value in USD. The unit every spending limit is expressed in. */
    valueUsd: z.number().finite().nonnegative(),
    slippageBps: z.number().int().min(0).max(10_000).optional(),
    /** Protocol the action interacts with. */
    targetContract: ContractIdSchema,
    /** Recipient, for value-exfiltrating actions. */
    destination: z.string().trim().min(3).max(80).optional(),
  })
  .strict();

export type AgentAction = z.infer<typeof AgentActionSchema>;

/** Every asset an action touches, deduplicated and uppercased. */
export function actionAssets(action: AgentAction): string[] {
  const assets = [action.assetIn, action.assetOut]
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    .map((a) => a.toUpperCase());
  return [...new Set(assets)];
}
