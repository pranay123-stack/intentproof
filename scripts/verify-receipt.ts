#!/usr/bin/env node --experimental-strip-types
/**
 * Verify an execution receipt from the command line.
 *
 * Verification is the one capability that has to be usable by someone who is not
 * the operator and does not trust them, so it needs an entry point that is not
 * "import our SDK". Everything below is a recomputation — the commitment is
 * re-derived from the policy, the receipt hash from the receipt, and the policy
 * engine is re-run at the timestamp the receipt claims.
 *
 * Usage:
 *   pnpm verify:receipt bundle.json
 *   cat bundle.json | pnpm verify:receipt
 *
 * The bundle is whatever `pnpm demo --emit` writes, or any JSON of the shape:
 *   { "intent": {…}, "receipt": {…} }
 *   { "intent": {…}, "receipts": [ {…}, … ] }
 */
import { readFileSync } from 'node:fs';
import {
  ExecutionReceiptSchema,
  ledgerFromHistory,
  verifyExecution,
  type AuthorizedIntent,
  type ExecutionReceipt,
} from '@intentproof/sdk';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function die(message: string): never {
  console.error(`\n  ${RED}✗${RESET} ${message}\n`);
  process.exit(2);
}

function readInput(): unknown {
  const path = process.argv[2];
  const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  if (raw.trim().length === 0) {
    die('No input. Pass a bundle path or pipe JSON on stdin.');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    die(`Input is not valid JSON: ${(error as Error).message}`);
  }
}

function main(): void {
  const bundle = readInput() as {
    intent?: AuthorizedIntent;
    receipt?: unknown;
    receipts?: unknown[];
  };

  if (!bundle.intent) {
    die('Bundle has no "intent". Verification needs the policy to recompute the commitment.');
  }

  const rawReceipts = bundle.receipts ?? (bundle.receipt ? [bundle.receipt] : []);
  if (rawReceipts.length === 0) {
    die('Bundle has no "receipt" or "receipts".');
  }

  const receipts: ExecutionReceipt[] = rawReceipts.map((raw, index) => {
    const parsed = ExecutionReceiptSchema.safeParse(raw);
    if (!parsed.success) {
      die(
        `Receipt ${index} does not match the receipt schema:\n    ` +
          parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n    '),
      );
    }
    return parsed.data;
  });

  const intent = bundle.intent;
  console.log(`\n  intent  ${intent.intentHash}`);
  console.log(`  mode    ${intent.mode}`);
  console.log(`  ${receipts.length} receipt(s)\n`);

  let failed = 0;
  let indeterminate = 0;

  for (const [index, receipt] of receipts.entries()) {
    // The budget a receipt was evaluated against is whatever the receipts before
    // it consumed — replaying with an empty ledger would wrongly allow anything
    // that was rejected only for exhausting the daily cap.
    const report = verifyExecution({
      intent,
      receipt,
      ledgerBefore: ledgerFromHistory(receipts.slice(0, index)),
    });

    const bad = report.failedFindings.length > 0;
    const unknown = report.verdict === 'INDETERMINATE';
    if (bad) failed += 1;
    else if (unknown) indeterminate += 1;

    const mark = bad ? `${RED}✗${RESET}` : unknown ? `${YELLOW}○${RESET}` : `${GREEN}✓${RESET}`;
    console.log(
      `  ${mark} ${receipt.receiptHash.slice(0, 24)}…  ${receipt.policyResult.padEnd(8)} ${report.verdict}`,
    );
    for (const finding of report.findings) {
      if (finding.passed === true) continue;
      const icon = finding.passed === false ? `${RED}✗${RESET}` : `${YELLOW}○${RESET}`;
      console.log(`      ${icon} ${finding.title}: ${DIM}${finding.detail}${RESET}`);
    }
  }

  console.log('');
  if (failed > 0) {
    console.log(`  ${RED}EXECUTION NOT AUTHORIZED${RESET} — ${failed} of ${receipts.length} receipts failed.\n`);
    process.exit(1);
  }
  if (indeterminate > 0) {
    console.log(
      `  ${YELLOW}VERIFIED LOCALLY${RESET} — every recomputable check passed on all ${receipts.length} receipts.\n` +
        `  ${DIM}No chain record was consulted, so this is not proof of on-chain execution.${RESET}\n`,
    );
    process.exit(0);
  }
  console.log(`  ${GREEN}EXECUTION REMAINED WITHIN AUTHORIZED INTENT${RESET}\n`);
}

main();
