/**
 * The check list, in evaluation order.
 *
 * The order is part of the protocol: it is committed inside every receipt, and
 * the Cairo contract reports failures in the same sequence. Renaming or
 * reordering a check changes every receipt hash, which is why the list lives in
 * one place rather than being spelled out at each call site.
 */
export const CHECK_ORDER = [
  'intent_hash_integrity',
  'agent_authorized',
  'intent_not_revoked',
  'intent_not_expired',
  'action_allowed',
  'action_not_forbidden',
  'asset_allowed',
  'contract_allowed',
  'destination_allowed',
  'transaction_limit',
  'slippage_limit',
  'daily_limit',
  'replay_protection',
] as const;

export type CheckName = (typeof CHECK_ORDER)[number];

export const CHECK_DESCRIPTIONS: Record<CheckName, string> = {
  intent_hash_integrity:
    'The policy still hashes to the commitment that was registered.',
  agent_authorized: 'The acting agent is the one the intent names.',
  intent_not_revoked: 'The user has not revoked this authorization.',
  intent_not_expired: 'The authorization has not lapsed.',
  action_allowed: 'The action kind appears in the allowed list.',
  action_not_forbidden: 'The action kind does not appear in the forbidden list.',
  asset_allowed: 'Every asset the action touches is authorized.',
  contract_allowed: 'The target protocol is on the allowlist.',
  destination_allowed: 'Any recipient of outbound value is on the allowlist.',
  transaction_limit: 'The action is within the per-transaction cap.',
  slippage_limit: 'Requested slippage is within the authorized bound.',
  daily_limit: 'The action fits inside the remaining daily budget.',
  replay_protection: 'This action has not already been executed under this intent.',
};
