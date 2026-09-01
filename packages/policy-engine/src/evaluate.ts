import {
  actionAssets,
  computeIntentHash,
  canonicalPolicyJson,
  describeContractId,
  feltEquals,
  poseidonCommit,
  VALUE_EXFILTRATING_ACTIONS,
  type AgentAction,
  type AuthorizedIntent,
  type PolicyCheck,
} from '@intentproof/intent-schema';
import { CHECK_ORDER, type CheckName } from './checks.js';
import { EMPTY_LEDGER, spentOnDay, type LedgerSnapshot } from './ledger.js';

export interface EvaluationInput {
  readonly intent: AuthorizedIntent;
  readonly action: AgentAction;
  readonly now?: Date;
  readonly ledger?: LedgerSnapshot;
  /** Agent claiming to act. Defaults to the agent the intent names. */
  readonly agentId?: string;
}

export interface EvaluationResult {
  readonly allowed: boolean;
  readonly checks: readonly PolicyCheck[];
  /** Details of every failed check, in order. Empty when allowed. */
  readonly reasons: readonly string[];
  /** Names of failed checks, for programmatic handling. */
  readonly failedChecks: readonly CheckName[];
}

const usd = (value: number): string =>
  `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * The deterministic authorization decision.
 *
 * No model is consulted here, and no network call is made. Given the same
 * intent, action, clock and ledger this function returns the same verdict on any
 * machine — which is what lets an independent party re-run it from a receipt and
 * get the same answer.
 *
 * Every check runs even after one fails. Short-circuiting would be marginally
 * faster and would hide the other reasons an action was out of bounds, and the
 * receipt is meant to show the whole picture.
 */
export function evaluateAction(input: EvaluationInput): EvaluationResult {
  const { intent, action } = input;
  const now = input.now ?? new Date();
  const ledger = input.ledger ?? EMPTY_LEDGER;
  const agentId = input.agentId ?? intent.agentId;
  const policy = intent.policy;

  const results = new Map<CheckName, PolicyCheck>();
  const record = (name: CheckName, passed: boolean, detail: string): void => {
    results.set(name, { name, passed, detail });
  };

  // 1. Integrity. Checked first because every later check reads `policy`, and a
  //    policy that no longer matches its commitment is not the one that was
  //    approved — the remaining verdicts would be about the wrong document.
  const recomputed = computeIntentHash(policy);
  const canonicalMatches = canonicalPolicyJson(policy) === intent.canonical;
  const canonicalHashes = feltEquals(poseidonCommit(intent.canonical), intent.intentHash);
  const integrityOk = feltEquals(recomputed, intent.intentHash) && canonicalMatches && canonicalHashes;
  record(
    'intent_hash_integrity',
    integrityOk,
    integrityOk
      ? `Policy hashes to ${intent.intentHash.slice(0, 18)}…, matching the commitment.`
      : `Policy no longer matches its commitment: recomputed ${recomputed.slice(0, 18)}… against registered ${intent.intentHash.slice(0, 18)}….`,
  );

  // 2. Agent identity.
  const agentOk = agentId === intent.agentId;
  record(
    'agent_authorized',
    agentOk,
    agentOk
      ? `Agent ${agentId} is the agent this intent authorizes.`
      : `Agent ${agentId} is not ${intent.agentId}, the only agent this intent authorizes.`,
  );

  // 3-4. Lifecycle.
  const revoked = intent.revokedAt !== null && Date.parse(intent.revokedAt) <= now.getTime();
  record(
    'intent_not_revoked',
    !revoked,
    revoked
      ? `Authorization was revoked at ${intent.revokedAt}.`
      : 'Authorization has not been revoked.',
  );

  const expiresAtMs = Date.parse(policy.expiresAt);
  const expired = expiresAtMs <= now.getTime();
  record(
    'intent_not_expired',
    !expired,
    expired
      ? `Authorization expired at ${policy.expiresAt}.`
      : `Authorization valid until ${policy.expiresAt}.`,
  );

  // 5-6. Action kind. Allowlist and denylist are separate checks because the
  //      user experiences them as separate promises ("you may swap" is not the
  //      same statement as "you may never borrow").
  const kind = action.kind;
  const allowedActions = policy.allowedActions.map((a) => a.toLowerCase());
  const forbiddenActions = policy.forbiddenActions.map((a) => a.toLowerCase());

  const actionAllowed = allowedActions.includes(kind);
  record(
    'action_allowed',
    actionAllowed,
    actionAllowed
      ? `"${kind}" is in the allowed actions.`
      : `"${kind}" is not in the allowed actions (${allowedActions.join(', ') || 'none'}).`,
  );

  const notForbidden = !forbiddenActions.includes(kind);
  record(
    'action_not_forbidden',
    notForbidden,
    notForbidden
      ? `"${kind}" is not in the forbidden actions.`
      : `"${kind}" is explicitly forbidden by this authorization.`,
  );

  // 7. Assets.
  const allowedAssets = new Set(policy.allowedAssets.map((a) => a.toUpperCase()));
  const assets = actionAssets(action);
  const unauthorizedAssets = assets.filter((a) => !allowedAssets.has(a));
  const assetsOk = unauthorizedAssets.length === 0;
  record(
    'asset_allowed',
    assetsOk,
    assetsOk
      ? assets.length > 0
        ? `${assets.join(', ')} authorized.`
        : 'Action references no assets.'
      : `${unauthorizedAssets.join(', ')} not in the authorized asset set (${[...allowedAssets].join(', ')}).`,
  );

  // 8. Target protocol.
  const allowedContracts = new Set(
    policy.allowedContracts.map((c) => (c.startsWith('0x') ? c.toLowerCase() : c.toUpperCase())),
  );
  const target = action.targetContract.startsWith('0x')
    ? action.targetContract.toLowerCase()
    : action.targetContract.toUpperCase();
  const contractOk = allowedContracts.has(target);
  record(
    'contract_allowed',
    contractOk,
    contractOk
      ? `${describeContractId(action.targetContract)} is an approved protocol.`
      : `${describeContractId(action.targetContract)} is not on the approved protocol list.`,
  );

  // 9. Destination. Absence of an allowlist means "nowhere", never "anywhere".
  const allowedDestinations = new Set(
    (policy.allowedDestinations ?? []).map((c) =>
      c.startsWith('0x') ? c.toLowerCase() : c.toUpperCase(),
    ),
  );
  const needsDestination = VALUE_EXFILTRATING_ACTIONS.includes(kind);
  let destinationOk: boolean;
  let destinationDetail: string;
  if (!needsDestination && action.destination === undefined) {
    destinationOk = true;
    destinationDetail = 'Action sends no value to a third party.';
  } else if (action.destination === undefined) {
    destinationOk = false;
    destinationDetail = `A "${kind}" must name a destination; none was given.`;
  } else {
    const destination = action.destination.startsWith('0x')
      ? action.destination.toLowerCase()
      : action.destination.toUpperCase();
    destinationOk = allowedDestinations.has(destination);
    destinationDetail = destinationOk
      ? `${describeContractId(action.destination)} is an authorized destination.`
      : allowedDestinations.size === 0
        ? `Destination ${describeContractId(action.destination)} is not authorized: this intent has no destination allowlist at all.`
        : `Destination ${describeContractId(action.destination)} is not in the authorized destination set.`;
  }
  record('destination_allowed', destinationOk, destinationDetail);

  // 10. Per-transaction cap. A missing cap is treated as zero authority, not as
  //     unlimited authority — semantic validation refuses to create such an
  //     intent, and if one arrives anyway it must not be the permissive case.
  const maxTx = policy.maxTransactionValueUsd;
  const txOk = maxTx !== undefined && action.valueUsd <= maxTx;
  record(
    'transaction_limit',
    txOk,
    maxTx === undefined
      ? 'No per-transaction cap is set; unbounded authority is never granted.'
      : txOk
        ? `${usd(action.valueUsd)} is within the ${usd(maxTx)} per-transaction cap.`
        : `${usd(action.valueUsd)} exceeds the ${usd(maxTx)} per-transaction cap.`,
  );

  // 11. Slippage.
  const maxSlippage = policy.maxSlippageBps;
  const slippage = action.slippageBps;
  let slippageOk: boolean;
  let slippageDetail: string;
  if (slippage === undefined) {
    slippageOk = true;
    slippageDetail = 'Action declares no slippage.';
  } else if (maxSlippage === undefined) {
    slippageOk = false;
    slippageDetail = `Action requests ${slippage} bps of slippage but the policy sets no bound.`;
  } else {
    slippageOk = slippage <= maxSlippage;
    slippageDetail = slippageOk
      ? `${slippage} bps is within the ${maxSlippage} bps bound.`
      : `${slippage} bps exceeds the ${maxSlippage} bps bound.`;
  }
  record('slippage_limit', slippageOk, slippageDetail);

  // 12. Daily budget.
  const maxDaily = policy.maxDailySpendUsd;
  const spentToday = spentOnDay(ledger, now);
  const dailyOk = maxDaily !== undefined && spentToday + action.valueUsd <= maxDaily;
  record(
    'daily_limit',
    dailyOk,
    maxDaily === undefined
      ? 'No daily cap is set; unbounded authority is never granted.'
      : dailyOk
        ? `${usd(spentToday + action.valueUsd)} of the ${usd(maxDaily)} daily budget after this action.`
        : `${usd(spentToday)} already spent today; ${usd(action.valueUsd)} more would exceed the ${usd(maxDaily)} daily cap.`,
  );

  // 13. Replay.
  const replayed = ledger.executedActionIds.includes(action.id);
  record(
    'replay_protection',
    !replayed,
    replayed
      ? `Action ${action.id} has already been executed under this intent.`
      : `Action ${action.id} has not been seen before.`,
  );

  const checks = CHECK_ORDER.map((name) => {
    const check = results.get(name);
    /* c8 ignore next */
    if (!check) throw new Error(`policy engine did not evaluate "${name}"`);
    return check;
  });

  const failed = checks.filter((c) => !c.passed);
  return {
    allowed: failed.length === 0,
    checks,
    reasons: failed.map((c) => c.detail),
    failedChecks: failed.map((c) => c.name as CheckName),
  };
}
