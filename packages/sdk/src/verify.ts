import {
  canonicalPolicyJson,
  computeActionHash,
  computeReceiptHash,
  feltEquals,
  intentStatus,
  poseidonCommit,
  type AuthorizedIntent,
  type ExecutionReceipt,
} from '@intentproof/intent-schema';
import { replayReceipt, type LedgerSnapshot } from '@intentproof/policy-engine';
import type { OnChainVerification } from '@intentproof/starknet';

export type VerificationVerdict =
  | 'EXECUTION_WITHIN_INTENT'
  | 'EXECUTION_NOT_AUTHORIZED'
  | 'INDETERMINATE';

export type FindingSource = 'local' | 'chain';

export interface VerificationFinding {
  readonly name: string;
  readonly title: string;
  /** `null` means "not applicable here", which is not the same as a failure. */
  readonly passed: boolean | null;
  readonly detail: string;
  readonly source: FindingSource;
}

export interface VerificationReport {
  readonly verdict: VerificationVerdict;
  readonly intentHash: string;
  readonly receiptHash: string;
  readonly transactionHash: string | null;
  readonly findings: readonly VerificationFinding[];
  readonly failedFindings: readonly VerificationFinding[];
  readonly onChain: OnChainVerification | null;
}

export interface VerifyInput {
  readonly intent: AuthorizedIntent;
  readonly receipt: ExecutionReceipt;
  /** Ledger state immediately before this receipt, rebuilt from prior receipts. */
  readonly ledgerBefore?: LedgerSnapshot;
  readonly onChain?: OnChainVerification | null;
}

/**
 * Independent verification.
 *
 * Everything below is recomputed from the intent and the receipt. Nothing is
 * read from a database and then trusted: the commitment is re-hashed, the
 * canonical form is re-derived from the policy, the action hash is recomputed,
 * and the policy engine is re-run at the receipt's own timestamp.
 *
 * The verdict distinguishes three cases, not two. A receipt that verifies
 * locally but that the chain has never heard of is INDETERMINATE, not
 * authorized — saying "verified" there would be the single most misleading
 * thing this system could do.
 */
export function verifyExecution(input: VerifyInput): VerificationReport {
  const { intent, receipt } = input;
  const findings: VerificationFinding[] = [];

  const commitmentOk = feltEquals(poseidonCommit(intent.canonical), intent.intentHash);
  findings.push({
    name: 'intent_commitment',
    title: 'Intent commitment',
    passed: commitmentOk,
    detail: commitmentOk
      ? `The canonical policy hashes to ${intent.intentHash.slice(0, 22)}…, the commitment on record.`
      : 'The canonical policy does not hash to the recorded commitment.',
    source: 'local',
  });

  const canonicalOk = canonicalPolicyJson(intent.policy) === intent.canonical;
  findings.push({
    name: 'policy_integrity',
    title: 'Policy integrity',
    passed: canonicalOk,
    detail: canonicalOk
      ? 'Re-canonicalizing the stored policy reproduces the exact bytes that were committed.'
      : 'The stored policy no longer canonicalizes to the committed bytes: it has been edited since approval.',
    source: 'local',
  });

  const agentOk = receipt.agentId === intent.agentId;
  findings.push({
    name: 'agent_authorization',
    title: 'Agent authorization',
    passed: agentOk,
    detail: agentOk
      ? `${receipt.agentId} is the agent this intent authorizes.`
      : `${receipt.agentId} is not ${intent.agentId}, the only agent this intent authorizes.`,
    source: 'local',
  });

  const sealOk = feltEquals(computeReceiptHash(receipt), receipt.receiptHash);
  const actionOk = feltEquals(computeActionHash(receipt.action), receipt.actionHash);
  findings.push({
    name: 'receipt_integrity',
    title: 'Receipt integrity',
    passed: sealOk && actionOk,
    detail:
      sealOk && actionOk
        ? 'The receipt and the action it records both hash to their committed values.'
        : !sealOk
          ? 'The receipt has been altered since it was sealed.'
          : 'The action recorded in the receipt does not match its committed hash.',
    source: 'local',
  });

  const replay = replayReceipt({
    intent,
    receipt,
    ...(input.ledgerBefore ? { ledgerBefore: input.ledgerBefore } : {}),
  });
  const evaluation = replay.findings.find((f) => f.name === 'policy_evaluation');
  const agreement = replay.findings.find((f) => f.name === 'check_agreement');
  findings.push({
    name: 'policy_evaluation',
    title: 'Policy evaluation',
    passed: (evaluation?.passed ?? false) && (agreement?.passed ?? false),
    detail: [evaluation?.detail, agreement?.detail].filter(Boolean).join(' '),
    source: 'local',
  });

  const onChain = input.onChain ?? null;
  if (intent.mode === 'LOCAL_DEMO') {
    findings.push({
      name: 'transaction_association',
      title: 'Transaction association',
      passed: null,
      detail:
        'LOCAL DEMO MODE: this intent was never written to a blockchain, so there is no transaction to associate. Everything above was still checked.',
      source: 'chain',
    });
  } else if (onChain === null) {
    findings.push({
      name: 'transaction_association',
      title: 'Transaction association',
      passed: null,
      detail:
        'No Starknet endpoint was available to confirm this receipt on chain. The local checks stand; the on-chain record was not consulted.',
      source: 'chain',
    });
  } else {
    findings.push({
      name: 'transaction_association',
      title: 'Transaction association',
      passed: onChain.verified,
      detail: onChain.verified
        ? `The registry confirms this receipt against the intent${receipt.transactionHash ? ` (tx ${receipt.transactionHash.slice(0, 14)}…)` : ''}.`
        : `The registry rejects this receipt: ${onChain.failureCode ?? 'unknown reason'}.`,
      source: 'chain',
    });
  }

  const status = intentStatus(intent, new Date(receipt.timestamp));
  findings.push({
    name: 'intent_status_at_execution',
    title: 'Authorization live at execution',
    passed: status === 'ACTIVE',
    detail:
      status === 'ACTIVE'
        ? `The intent was ${status.toLowerCase()} when this action was evaluated.`
        : `The intent was already ${status.toLowerCase()} when this action was evaluated.`,
    source: 'local',
  });

  const failed = findings.filter((f) => f.passed === false);
  const indeterminate = findings.some((f) => f.passed === null);

  const verdict: VerificationVerdict =
    failed.length > 0
      ? 'EXECUTION_NOT_AUTHORIZED'
      : indeterminate
        ? 'INDETERMINATE'
        : 'EXECUTION_WITHIN_INTENT';

  return {
    verdict,
    intentHash: intent.intentHash,
    receiptHash: receipt.receiptHash,
    transactionHash: receipt.transactionHash,
    findings,
    failedFindings: failed,
    onChain,
  };
}

/**
 * A receipt marked REJECTED is *correct* when the engine agrees it should have
 * been rejected. Verification is about whether the record is faithful, not about
 * whether the agent got what it wanted.
 */
export function receiptDemonstratesRefusal(report: VerificationReport, receipt: ExecutionReceipt): boolean {
  return receipt.policyResult === 'REJECTED' && report.verdict !== 'EXECUTION_NOT_AUTHORIZED';
}
