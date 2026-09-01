import {
  computeReceiptHash,
  receiptIsIntact,
  computeActionHash,
  feltEquals,
  type AuthorizedIntent,
  type ExecutionReceipt,
} from '@intentproof/intent-schema';
import { evaluateAction } from './evaluate.js';
import { EMPTY_LEDGER, type LedgerSnapshot } from './ledger.js';

export interface ReplayFinding {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ReplayResult {
  readonly verified: boolean;
  readonly findings: readonly ReplayFinding[];
}

export interface ReplayInput {
  readonly intent: AuthorizedIntent;
  readonly receipt: ExecutionReceipt;
  /** State as of the moment the receipt was produced, rebuilt from history. */
  readonly ledgerBefore?: LedgerSnapshot;
}

/**
 * Independent re-derivation of a past decision.
 *
 * This is the verifier's core, and it deliberately duplicates no logic: it
 * re-runs the *same* `evaluateAction` against the intent and the action recorded
 * in the receipt, at the timestamp the receipt claims, and checks that the
 * verdict and the check-by-check outcomes are what the receipt says they were.
 *
 * A receipt therefore cannot claim ALLOWED for an action the engine rejects, and
 * cannot claim a passing check the engine fails — the two would disagree here.
 */
export function replayReceipt(input: ReplayInput): ReplayResult {
  const { intent, receipt } = input;
  const findings: ReplayFinding[] = [];
  const add = (name: string, passed: boolean, detail: string): void => {
    findings.push({ name, passed, detail });
  };

  const sealOk = receiptIsIntact(receipt);
  add(
    'receipt_integrity',
    sealOk,
    sealOk
      ? `Receipt hashes to ${receipt.receiptHash.slice(0, 18)}….`
      : `Receipt has been altered: it hashes to ${computeReceiptHash(receipt).slice(0, 18)}…, not the ${receipt.receiptHash.slice(0, 18)}… it claims.`,
  );

  const bound = feltEquals(receipt.intentHash, intent.intentHash);
  add(
    'intent_binding',
    bound,
    bound
      ? 'Receipt references the intent commitment it was checked against.'
      : `Receipt references ${receipt.intentHash.slice(0, 18)}…, not this intent's ${intent.intentHash.slice(0, 18)}….`,
  );

  const actionHashOk = feltEquals(computeActionHash(receipt.action), receipt.actionHash);
  add(
    'action_integrity',
    actionHashOk,
    actionHashOk
      ? 'The recorded action matches its committed hash.'
      : 'The recorded action does not match the action hash in the receipt.',
  );

  const replay = evaluateAction({
    intent,
    action: receipt.action,
    now: new Date(receipt.timestamp),
    ledger: input.ledgerBefore ?? EMPTY_LEDGER,
    agentId: receipt.agentId,
  });

  const expected = replay.allowed ? 'ALLOWED' : 'REJECTED';
  const verdictOk = expected === receipt.policyResult;
  add(
    'policy_evaluation',
    verdictOk,
    verdictOk
      ? `Re-running the policy engine at ${receipt.timestamp} reproduces ${expected}.`
      : `Receipt claims ${receipt.policyResult}, but re-running the policy engine yields ${expected}.`,
  );

  const mismatched = replay.checks.filter((check, index) => {
    const recorded = receipt.checks[index];
    return !recorded || recorded.name !== check.name || recorded.passed !== check.passed;
  });
  const checksOk = mismatched.length === 0 && replay.checks.length === receipt.checks.length;
  add(
    'check_agreement',
    checksOk,
    checksOk
      ? `All ${replay.checks.length} checks reproduce exactly.`
      : `Checks disagree on: ${mismatched.map((c) => c.name).join(', ') || 'list length'}.`,
  );

  return { verified: findings.every((f) => f.passed), findings };
}
