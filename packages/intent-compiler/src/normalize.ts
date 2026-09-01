import {
  IntentPolicySchema,
  INTENT_POLICY_VERSION,
  MAX_INTENT_TTL_SECONDS,
  MIN_INTENT_TTL_SECONDS,
  validatePolicySemantics,
  type IntentPolicy,
  type IntentProposal,
} from '@intentproof/intent-schema';
import { CompilationError } from './types.js';

/**
 * Turn a model proposal into a policy.
 *
 * The expiry is computed here from a *duration*, never taken as an absolute
 * timestamp from the model. Models are unreliable about the current date, and a
 * hallucinated "expiresAt: 2024-01-01" would produce an authorization that is
 * either already dead or, worse, silently long-lived. The server owns the clock.
 */
export function proposalToPolicy(proposal: IntentProposal, now: Date): IntentPolicy {
  const durationSeconds = Math.round((proposal.durationHours ?? 24) * 3600);
  const clamped = Math.min(Math.max(durationSeconds, MIN_INTENT_TTL_SECONDS), MAX_INTENT_TTL_SECONDS);
  const expiresAt = new Date(now.getTime() + clamped * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/u, 'Z');

  const policy: Record<string, unknown> = {
    version: INTENT_POLICY_VERSION,
    purpose: proposal.purpose,
    allowedActions: proposal.allowedActions,
    forbiddenActions: proposal.forbiddenActions,
    allowedAssets: proposal.allowedAssets,
    allowedContracts: proposal.allowedContracts,
    expiresAt,
    metadata: { explanation: proposal.explanation },
  };
  if (proposal.allowedDestinations && proposal.allowedDestinations.length > 0) {
    policy.allowedDestinations = proposal.allowedDestinations;
  }
  if (proposal.maxTransactionValueUsd !== null) {
    policy.maxTransactionValueUsd = proposal.maxTransactionValueUsd;
  }
  if (proposal.maxDailySpendUsd !== null) {
    policy.maxDailySpendUsd = proposal.maxDailySpendUsd;
  }
  if (proposal.maxSlippageBps !== null) {
    policy.maxSlippageBps = proposal.maxSlippageBps;
  }
  return policy as IntentPolicy;
}

export interface FinalizeResult {
  readonly policy: IntentPolicy;
  readonly warnings: readonly string[];
}

/**
 * The two gates every compiler output passes, whatever produced it.
 *
 * Schema first, then semantics. A compiler that skips this cannot produce an
 * intent, which is why it lives here rather than inside any one implementation.
 */
export function finalizeProposal(proposal: IntentProposal, now: Date): FinalizeResult {
  const parsed = IntentPolicySchema.safeParse(proposalToPolicy(proposal, now));
  if (!parsed.success) {
    throw new CompilationError(
      'schema',
      'The compiler produced a policy that does not match the IntentPolicy schema.',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  const semantics = validatePolicySemantics(parsed.data, { now });
  if (!semantics.ok) {
    throw new CompilationError(
      'semantic',
      'The proposed policy is structurally valid but cannot be authorized.',
      semantics.errors.map((i) => `${i.field}: ${i.message}`),
      semantics.errors,
    );
  }

  return {
    policy: parsed.data,
    warnings: semantics.advisories.map((i) => `${i.field}: ${i.message}`),
  };
}
