import { LEVERAGE_ACTIONS, VALUE_EXFILTRATING_ACTIONS } from './actions.js';
import {
  MAX_ACCEPTABLE_SLIPPAGE_BPS,
  MAX_INTENT_TTL_SECONDS,
  MIN_INTENT_TTL_SECONDS,
} from './constants.js';
import { isResolvableContractId } from './protocols.js';
import type { IntentPolicy } from './policy.js';

/**
 * `error` blocks compilation outright. `advisory` is surfaced to the user in the
 * review step but does not stop them approving — the distinction matters because
 * some policies are unusual without being wrong, and refusing those would push
 * users toward vaguer descriptions.
 */
export type SemanticSeverity = 'error' | 'advisory';

export interface SemanticIssue {
  readonly field: string;
  readonly message: string;
  readonly severity: SemanticSeverity;
}

export interface SemanticValidationResult {
  /** True when there are no `error`-severity issues. Advisories do not block. */
  readonly ok: boolean;
  readonly issues: readonly SemanticIssue[];
  readonly errors: readonly SemanticIssue[];
  readonly advisories: readonly SemanticIssue[];
}

export interface SemanticValidationOptions {
  readonly now?: Date;
  readonly maxTtlSeconds?: number;
}

/**
 * Checks a schema-valid policy for meanings the schema cannot express.
 *
 * This is the second of the three gates between the model and a commitment
 * (schema → semantics → human approval). It is where "structurally fine but
 * nobody should ever authorize this" gets caught: unbounded spend, an
 * authorization that never expires, a transfer permission with no recipient
 * list, a protocol name the model invented.
 */
export function validatePolicySemantics(
  policy: IntentPolicy,
  options: SemanticValidationOptions = {},
): SemanticValidationResult {
  const now = options.now ?? new Date();
  const maxTtl = options.maxTtlSeconds ?? MAX_INTENT_TTL_SECONDS;
  const issues: SemanticIssue[] = [];

  const allowed = new Set(policy.allowedActions.map((a) => a.toLowerCase()));
  const forbidden = new Set(policy.forbiddenActions.map((a) => a.toLowerCase()));

  const contradictions = [...allowed].filter((a) => forbidden.has(a));
  if (contradictions.length > 0) {
    issues.push({
      field: 'allowedActions',
      message: `contradictory: ${contradictions.join(', ')} appear in both the allowed and forbidden lists`,
      severity: 'error',
    });
  }

  const expiresAtMs = Date.parse(policy.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    issues.push({
      field: 'expiresAt',
      message: 'not a parseable timestamp',
      severity: 'error',
    });
  } else {
    const ttlSeconds = Math.floor((expiresAtMs - now.getTime()) / 1000);
    if (ttlSeconds < MIN_INTENT_TTL_SECONDS) {
      issues.push({
        field: 'expiresAt',
        message: `expires in ${ttlSeconds}s; an authorization must be valid for at least ${MIN_INTENT_TTL_SECONDS}s`,
        severity: 'error',
      });
    } else if (ttlSeconds > maxTtl) {
      issues.push({
        field: 'expiresAt',
        message: `expires in ${Math.round(ttlSeconds / 86400)} days; the ceiling is ${Math.round(maxTtl / 86400)} days`,
        severity: 'error',
      });
    }
  }

  // An authorization with no ceiling is the exact failure this project exists to
  // prevent, so a missing limit is a rejection rather than a default.
  if (policy.maxTransactionValueUsd === undefined) {
    issues.push({
      field: 'maxTransactionValueUsd',
      message: 'missing: an intent without a per-transaction cap grants unbounded authority',
      severity: 'error',
    });
  }
  if (policy.maxDailySpendUsd === undefined) {
    issues.push({
      field: 'maxDailySpendUsd',
      message: 'missing: an intent without a daily cap grants unbounded authority over time',
      severity: 'error',
    });
  }
  if (
    policy.maxTransactionValueUsd !== undefined &&
    policy.maxDailySpendUsd !== undefined &&
    policy.maxDailySpendUsd < policy.maxTransactionValueUsd
  ) {
    issues.push({
      field: 'maxDailySpendUsd',
      message: `daily cap ($${policy.maxDailySpendUsd}) is below the per-transaction cap ($${policy.maxTransactionValueUsd}), so the per-transaction cap can never be reached`,
      severity: 'advisory',
    });
  }

  for (const [field, value] of [
    ['maxTransactionValueUsd', policy.maxTransactionValueUsd],
    ['maxDailySpendUsd', policy.maxDailySpendUsd],
  ] as const) {
    if (value !== undefined && Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
      issues.push({
        field,
        message: `$${value} is finer than one cent and cannot be committed exactly`,
        severity: 'error',
      });
    }
  }

  if (policy.maxSlippageBps !== undefined && policy.maxSlippageBps > MAX_ACCEPTABLE_SLIPPAGE_BPS) {
    issues.push({
      field: 'maxSlippageBps',
      message: `${policy.maxSlippageBps} bps (${policy.maxSlippageBps / 100}%) exceeds the ${MAX_ACCEPTABLE_SLIPPAGE_BPS / 100}% ceiling`,
      severity: 'error',
    });
  }

  for (const id of policy.allowedContracts) {
    if (!isResolvableContractId(id)) {
      issues.push({
        field: 'allowedContracts',
        message: `"${id}" is neither a Starknet address nor a known protocol label`,
        severity: 'error',
      });
    }
  }
  for (const id of policy.allowedDestinations ?? []) {
    if (!isResolvableContractId(id)) {
      issues.push({
        field: 'allowedDestinations',
        message: `"${id}" is neither a Starknet address nor a known protocol label`,
        severity: 'error',
      });
    }
  }

  const exfiltrating = VALUE_EXFILTRATING_ACTIONS.filter((a) => allowed.has(a));
  if (exfiltrating.length > 0 && (policy.allowedDestinations ?? []).length === 0) {
    issues.push({
      field: 'allowedDestinations',
      message: `${exfiltrating.join(', ')} is allowed but no destination allowlist was given; silence here would mean "anywhere"`,
      severity: 'error',
    });
  }

  // Not an error — a policy may legitimately allow borrowing — but worth
  // surfacing when the user's words said one thing and the model wrote another.
  const leverageAllowed = LEVERAGE_ACTIONS.filter((a) => allowed.has(a));
  if (leverageAllowed.length > 0 && forbidden.size === 0) {
    issues.push({
      field: 'allowedActions',
      message: `${leverageAllowed.join(', ')} is allowed and nothing is forbidden; confirm this was intended`,
      severity: 'advisory',
    });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const advisories = issues.filter((i) => i.severity === 'advisory');
  return { ok: errors.length === 0, issues, errors, advisories };
}
