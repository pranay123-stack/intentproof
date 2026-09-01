import 'server-only';
import {
  ExecutionReceiptSchema,
  intentDisplayNumber,
  ledgerFromHistory,
  type AuthorizedIntent,
  type ExecutionReceipt,
} from '@intentproof/sdk';
import { z } from 'zod';
import { runtime } from './server';
import { intentStore } from './store';

export const VerifyRequestSchema = z
  .object({
    intentHash: z.string().trim().optional(),
    receiptHash: z.string().trim().optional(),
    transactionHash: z.string().trim().optional(),
    /** A full receipt, for verifying something this deployment never stored. */
    receipt: ExecutionReceiptSchema.optional(),
    /** The intent that receipt refers to, when it is not in our store either. */
    intent: z.unknown().optional(),
  })
  .refine(
    (v) => Boolean(v.receiptHash || v.receipt || v.intentHash),
    'Provide an intent hash, a receipt hash, or a full receipt.',
  );

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export interface VerifyFailure {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
}

export interface VerifySuccess {
  readonly ok: true;
  readonly payload: {
    report: Awaited<ReturnType<ReturnType<typeof runtime>['sdk']['verify']>>;
    intent: AuthorizedIntent;
    receipt: ExecutionReceipt;
    displayNumber: string | null;
    source: 'store' | 'supplied';
    transactionMatches: boolean | null;
    receiptIndex: number;
    historyLength: number;
  };
}

/**
 * Verification, shared by the API route and the server-rendered page.
 *
 * Both entry points run the same code so a link with `?receiptHash=…` shows the
 * same answer the endpoint would give — and the page can render the result on
 * the server instead of firing a request from an effect on mount.
 */
export async function performVerification(
  input: VerifyRequest,
): Promise<VerifySuccess | VerifyFailure> {
  const store = intentStore();
  const { sdk } = runtime();

  let intent: AuthorizedIntent | undefined;
  let receipt: ExecutionReceipt | undefined = input.receipt;
  let history: ExecutionReceipt[] = [];
  let source: 'store' | 'supplied' = 'store';
  let displayNumber: string | null = null;

  if (input.receiptHash) {
    const hit = store.findByReceipt(input.receiptHash);
    if (hit) {
      intent = hit.record.intent;
      receipt = hit.receipt;
      history = hit.record.receipts;
      displayNumber = intentDisplayNumber(hit.record.intent);
    }
  }

  if (!intent && input.intentHash) {
    const record = store.find(input.intentHash);
    if (record) {
      intent = record.intent;
      history = record.receipts;
      displayNumber = intentDisplayNumber(record.intent);
      receipt ??= record.receipts.at(-1);
    }
  }

  if (!intent && input.intent) {
    intent = input.intent as AuthorizedIntent;
    source = 'supplied';
  }

  if (!intent) {
    return {
      ok: false,
      status: 404,
      error:
        'No intent matches that hash on this deployment. Paste the full receipt and intent JSON to verify something recorded elsewhere.',
    };
  }
  if (!receipt) {
    return {
      ok: false,
      status: 404,
      error:
        'That intent exists but has no execution receipts yet. Run the agent against it first, or supply a receipt hash.',
    };
  }

  const index = history.findIndex((r) => r.receiptHash === receipt.receiptHash);
  const ledgerBefore = ledgerFromHistory(index > 0 ? history.slice(0, index) : []);
  const report = await sdk.verify({ intent, receipt, ledgerBefore });

  const transactionMatches =
    input.transactionHash === undefined || input.transactionHash.length === 0
      ? null
      : receipt.transactionHash !== null &&
        receipt.transactionHash.toLowerCase() === input.transactionHash.toLowerCase();

  return {
    ok: true,
    payload: {
      report,
      intent,
      receipt,
      displayNumber,
      source,
      transactionMatches,
      receiptIndex: index,
      historyLength: history.length,
    },
  };
}
