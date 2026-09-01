'use client';

import type { AuthorizedIntent, ExecutionReceipt } from '@intentproof/intent-schema';
import Link from 'next/link';
import { useState } from 'react';
import { shortHash, timestamp, usd } from '@/lib/format';
import { Badge, Panel, PanelHeader, SectionLabel, buttonClass } from './ui';

interface Finding {
  name: string;
  title: string;
  passed: boolean | null;
  detail: string;
  source: 'local' | 'chain';
}

interface Report {
  verdict: 'EXECUTION_WITHIN_INTENT' | 'EXECUTION_NOT_AUTHORIZED' | 'INDETERMINATE';
  intentHash: string;
  receiptHash: string;
  transactionHash: string | null;
  findings: readonly Finding[];
  failedFindings: readonly Finding[];
}

interface VerifyResponse {
  report: Report;
  intent: AuthorizedIntent;
  receipt: ExecutionReceipt;
  displayNumber: string | null;
  source: 'store' | 'supplied';
  transactionMatches: boolean | null;
  receiptIndex: number;
  historyLength: number;
}

const VERDICT_COPY: Record<Report['verdict'], { title: string; tone: string; body: string }> = {
  EXECUTION_WITHIN_INTENT: {
    title: 'Execution within intent',
    tone: 'text-allow',
    body: 'Every check reproduced, including confirmation from the Starknet registry.',
  },
  EXECUTION_NOT_AUTHORIZED: {
    title: 'Execution not authorized',
    tone: 'text-reject',
    body: 'At least one check failed. The rule that failed is named below.',
  },
  INDETERMINATE: {
    title: 'Verified locally · chain not consulted',
    tone: 'text-warn',
    body: 'Every recomputable check passed, but no on-chain record was available to confirm the receipt. That is reported as indeterminate rather than as proof.',
  },
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const id = `verify-${label.replace(/\s+/gu, '-').toLowerCase()}`;
  return (
    <label htmlFor={id} className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`mt-1.5 w-full rounded border border-line-strong bg-ink px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent-dim ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export function VerifyConsole({
  initialIntentHash = '',
  initialReceiptHash = '',
  initialResult = null,
  initialError = null,
}: {
  initialIntentHash?: string;
  initialReceiptHash?: string;
  /** Rendered on the server when the URL already carried a hash. */
  initialResult?: VerifyResponse | null;
  initialError?: string | null;
}) {
  const [intentHash, setIntentHash] = useState(initialIntentHash);
  const [receiptHash, setReceiptHash] = useState(initialReceiptHash);
  const [transactionHash, setTransactionHash] = useState('');
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [result, setResult] = useState<VerifyResponse | null>(initialResult);

  const verify = async () => {
    setBusy(true);
    setError(null);
    setResult(null);

    let body: Record<string, unknown> = {
      intentHash: intentHash || undefined,
      receiptHash: receiptHash || undefined,
      transactionHash: transactionHash || undefined,
    };

    if (showPaste && pasted.trim().length > 0) {
      try {
        const parsed = JSON.parse(pasted) as Record<string, unknown>;
        body = {
          ...body,
          receipt: 'receipt' in parsed ? parsed.receipt : parsed,
          intent: 'intent' in parsed ? parsed.intent : undefined,
        };
      } catch {
        setError('That is not valid JSON. Paste the receipt object, or an object containing "receipt" and "intent".');
        setBusy(false);
        return;
      }
    }

    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as VerifyResponse & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Verification failed.');
        return;
      }
      setResult(payload);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  // A link from an intent page arrives with the hash already in the URL. That
  // first result is rendered on the server and handed in as `initialResult`, so
  // the reader sees the answer immediately and no request fires on mount.
  const verdict = result ? VERDICT_COPY[result.report.verdict] : null;

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Verify an execution"
          meta="Every check below is a recomputation, not a database lookup"
        />
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Intent hash"
              value={intentHash}
              onChange={setIntentHash}
              placeholder="0x…"
            />
            <Field
              label="Receipt hash"
              value={receiptHash}
              onChange={setReceiptHash}
              placeholder="0x…"
            />
            <Field
              label="Transaction hash"
              value={transactionHash}
              onChange={setTransactionHash}
              placeholder="0x… (optional)"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="text-[12.5px] text-accent underline decoration-accent-dim underline-offset-2"
          >
            {showPaste ? 'Hide receipt JSON' : 'Verify a receipt this deployment has never seen →'}
          </button>

          {showPaste ? (
            <div>
              <label htmlFor="verify-json" className="block">
                <SectionLabel>Receipt JSON</SectionLabel>
              </label>
              <textarea
                id="verify-json"
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                rows={8}
                spellCheck={false}
                placeholder='{"version":1,"receiptHash":"0x…", …}'
                className="mt-1.5 w-full resize-y rounded border border-line-strong bg-ink px-3 py-2 font-mono text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent-dim"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-text-dim">
                Nothing about verification depends on us holding your data. Paste a receipt produced
                anywhere and the hashes are recomputed and the policy engine re-run here.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void verify()}
              disabled={busy}
              className={buttonClass.primary}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            {error ? (
              <p className="text-[12.5px] text-reject" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      {result && verdict ? (
        <div className="animate-in space-y-6">
          <Panel>
            <div className="border-b border-line px-5 py-6">
              <h2 className={`text-2xl font-semibold tracking-tight ${verdict.tone}`}>
                {verdict.title}
              </h2>
              <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-dim">
                {verdict.body}
              </p>
              {result.report.failedFindings.length > 0 ? (
                <ul className="mt-4 space-y-1.5">
                  {result.report.failedFindings.map((finding) => (
                    <li key={finding.name} className="text-[13px] leading-relaxed text-reject">
                      ✗ <strong>{finding.title}</strong> — {finding.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <ul className="divide-y divide-line/60">
              {result.report.findings.map((finding) => (
                <li key={finding.name} className="flex items-start gap-3 px-5 py-3">
                  <span
                    aria-hidden
                    className={`mt-0.5 font-mono text-[13px] ${
                      finding.passed === true
                        ? 'text-allow'
                        : finding.passed === false
                          ? 'text-reject'
                          : 'text-warn'
                    }`}
                  >
                    {finding.passed === true ? '✓' : finding.passed === false ? '✗' : '○'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-text">
                      {finding.title}
                      <span className="sr-only">
                        {finding.passed === true
                          ? ' passed'
                          : finding.passed === false
                            ? ' failed'
                            : ' not applicable'}
                      </span>
                      <span className="ml-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
                        {finding.source}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-dim">
                      {finding.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader
              title="What was verified"
              meta={
                result.source === 'supplied'
                  ? 'Supplied by you — not stored on this deployment'
                  : `Receipt ${result.receiptIndex + 1} of ${result.historyLength} under this intent`
              }
            >
              <Badge tone={result.receipt.policyResult === 'ALLOWED' ? 'allow' : 'reject'}>
                {result.receipt.policyResult}
              </Badge>
            </PanelHeader>
            <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                  Action
                </dt>
                <dd className="mt-0.5 text-[13px]">
                  {result.receipt.action.kind.replace(/_/gu, ' ')}
                  {result.receipt.action.assetIn ? ` ${result.receipt.action.assetIn}` : ''}
                  {result.receipt.action.assetOut ? ` → ${result.receipt.action.assetOut}` : ''} ·{' '}
                  {usd(result.receipt.action.valueUsd)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                  Evaluated at
                </dt>
                <dd className="mt-0.5 text-[13px]">{timestamp(result.receipt.timestamp)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                  Mode
                </dt>
                <dd className="mt-0.5 text-[13px]">{result.receipt.mode}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                  Intent hash
                </dt>
                <dd className="mt-0.5 hash">{result.report.intentHash}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                  Receipt hash
                </dt>
                <dd className="mt-0.5 hash">{result.report.receiptHash}</dd>
              </div>
              {result.transactionMatches !== null ? (
                <div className="sm:col-span-2">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                    Transaction hash you supplied
                  </dt>
                  <dd
                    className={`mt-0.5 text-[13px] ${result.transactionMatches ? 'text-allow' : 'text-reject'}`}
                  >
                    {result.transactionMatches
                      ? 'Matches the transaction recorded in this receipt.'
                      : `Does not match. This receipt records ${result.receipt.transactionHash ?? 'no transaction at all'}.`}
                  </dd>
                </div>
              ) : null}
            </dl>
            {result.displayNumber ? (
              <div className="border-t border-line px-5 py-3">
                <Link
                  href={`/intents/${result.intent.intentId}`}
                  className="text-[13px] text-accent underline decoration-accent-dim underline-offset-2"
                >
                  Open intent {result.displayNumber} →
                </Link>
              </div>
            ) : null}
          </Panel>

          <details className="rounded-lg border border-line bg-panel">
            <summary className="cursor-pointer px-4 py-3 text-[13px] text-text-dim hover:text-text">
              Receipt JSON ({shortHash(result.report.receiptHash, 10, 6)})
            </summary>
            <pre className="overflow-x-auto border-t border-line px-4 py-3 font-mono text-[11.5px] leading-relaxed text-text-dim">
              {JSON.stringify(result.receipt, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
