#!/usr/bin/env node --experimental-strip-types
/**
 * The whole pipeline, in a terminal.
 *
 * Same packages the web app uses, no HTTP layer. Useful as a smoke test, and as
 * the fastest way to show a reviewer that the enforcement is real code rather
 * than a rendered table.
 *
 * With OPENAI_API_KEY set it calls the model. Without one it uses the rule-based
 * compiler and says so.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_SCENARIO,
  IntentProofClient,
  computeIntentHash,
  ledgerFromHistory,
  selectIntentCompiler,
  selectRegistryClient,
} from '@intentproof/sdk';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(): void {
  for (const file of ['.env', '.env.local']) {
    const path = resolve(REPO, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u.exec(line);
      if (!match?.[1]) continue;
      const value = (match[2] ?? '').replace(/^["']|["']$/gu, '');
      if (value && !process.env[match[1]]) process.env[match[1]] = value;
    }
  }
}

const args = process.argv.slice(2);
const emitIndex = args.indexOf('--emit');
/** Where to write an { intent, receipts } bundle for `pnpm verify:receipt`. */
const emitPath = emitIndex === -1 ? null : (args[emitIndex + 1] ?? 'intentproof-bundle.json');
if (emitIndex !== -1) args.splice(emitIndex, emitPath === args[emitIndex + 1] ? 2 : 1);

const USER_WORDS =
  args.join(' ') ||
  'Manage my portfolio. You can swap ETH and STRK. Do not use leverage. Do not spend more than $500 per transaction or $1,000 per day. Only use approved protocols. Expires in 24 hours.';

const rule = (label: string): void => {
  console.log(`\n\x1b[2m${'─'.repeat(72)}\x1b[0m`);
  console.log(`\x1b[1m${label}\x1b[0m`);
};

const usd = (value: number): string => `$${value.toLocaleString('en-US')}`;

async function main(): Promise<void> {
  loadDotEnv();

  const compilerSelection = selectIntentCompiler(process.env);
  const registrySelection = selectRegistryClient(process.env);

  console.log('\n\x1b[1mIntentProof — end-to-end demo\x1b[0m');
  console.log(`\x1b[2m${compilerSelection.reason}\x1b[0m`);
  console.log(`\x1b[2m${registrySelection.reason}\x1b[0m`);

  const sdk = new IntentProofClient({
    compiler: compilerSelection.compiler,
    registry: registrySelection.client,
  });

  rule('1 · The human says');
  console.log(`  "${USER_WORDS}"`);

  rule('2 · Compiled to a structured policy');
  const compiled = await sdk.compileIntent({ naturalLanguage: USER_WORDS });
  const policy = compiled.policy;
  console.log(`  purpose      ${policy.purpose}`);
  console.log(`  allowed      ${policy.allowedActions.join(', ')}`);
  console.log(`  forbidden    ${policy.forbiddenActions.join(', ') || '(none)'}`);
  console.log(`  assets       ${policy.allowedAssets.join(', ')}`);
  console.log(`  protocols    ${policy.allowedContracts.join(', ')}`);
  console.log(`  max tx       ${usd(policy.maxTransactionValueUsd ?? 0)}`);
  console.log(`  max daily    ${usd(policy.maxDailySpendUsd ?? 0)}`);
  console.log(`  slippage     ${(policy.maxSlippageBps ?? 0) / 100}%`);
  console.log(`  expires      ${policy.expiresAt}`);
  console.log(`  source       ${compiled.provenance.isModelGenerated ? compiled.provenance.model : 'rule-based parser (no model)'}`);
  for (const warning of compiled.warnings) console.log(`  \x1b[33m⚠ ${warning}\x1b[0m`);

  rule('3 · Committed');
  console.log('  In the web app a human approves here. This script approves on your behalf.');
  const { intent, anchor } = await sdk.authorize({ policy });
  console.log(`  intent hash  ${intent.intentHash}`);
  console.log(`  recomputed   ${computeIntentHash(intent.policy)}`);
  console.log(`  mode         ${intent.mode}`);
  console.log(
    anchor
      ? `  transaction  ${anchor.transactionHash}\n  explorer     ${anchor.explorerUrl}`
      : '  transaction  none — LOCAL DEMO MODE, nothing was broadcast',
  );

  rule('4 · The agent proposes; the engine decides');
  const engine = sdk.engineFor(intent);
  const receipts = [];
  for (const [index, step] of DEMO_SCENARIO.entries()) {
    const action = step.build(intent, index);
    const { evaluation, receipt } = engine.decide({ action });
    receipts.push(receipt);
    const verdict = evaluation.allowed ? '\x1b[32m✓ ALLOWED \x1b[0m' : '\x1b[31m✗ REJECTED\x1b[0m';
    console.log(`  ${verdict}  ${step.label.padEnd(38)} ${evaluation.failedChecks.join(', ')}`);
    if (!evaluation.allowed) {
      for (const reason of evaluation.reasons) console.log(`             \x1b[2m${reason}\x1b[0m`);
    }
  }

  rule('5 · Verification');
  let failures = 0;
  for (const [index, receipt] of receipts.entries()) {
    const report = await sdk.verify({
      intent,
      receipt,
      ledgerBefore: ledgerFromHistory(receipts.slice(0, index)),
    });
    if (report.failedFindings.length > 0) {
      failures += 1;
      console.log(`  \x1b[31m✗\x1b[0m ${receipt.receiptHash.slice(0, 22)}… ${report.verdict}`);
      for (const finding of report.failedFindings) {
        console.log(`      ${finding.title}: ${finding.detail}`);
      }
    } else {
      console.log(`  \x1b[32m✓\x1b[0m ${receipt.receiptHash.slice(0, 22)}… ${report.verdict}`);
    }
  }

  if (emitPath) {
    writeFileSync(emitPath, `${JSON.stringify({ intent, receipts }, null, 2)}\n`, 'utf8');
    console.log(`\n  wrote ${emitPath} — check it with \`pnpm verify:receipt ${emitPath}\``);
  }

  const allowed = receipts.filter((r) => r.policyResult === 'ALLOWED');
  rule('Result');
  console.log(`  ${receipts.length} actions evaluated`);
  console.log(`  ${allowed.length} allowed`);
  console.log(`  ${receipts.length - allowed.length} rejected`);
  console.log(`  ${allowed.filter((r) => r.checks.some((c) => !c.passed)).length} unauthorized executions`);
  console.log(
    failures === 0
      ? '\n  \x1b[32mEXECUTION REMAINED WITHIN AUTHORIZED INTENT\x1b[0m\n'
      : `\n  \x1b[31m${failures} receipt(s) failed verification\x1b[0m\n`,
  );

  if (intent.mode === 'LOCAL_DEMO') {
    console.log(
      '  \x1b[2mLocal demo mode: every receipt verifies locally, and each verdict is\n' +
        '  INDETERMINATE rather than chain-confirmed, because no registry was configured.\x1b[0m\n',
    );
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`\n  ✗ ${(error as Error).message}\n`);
  process.exit(1);
});
