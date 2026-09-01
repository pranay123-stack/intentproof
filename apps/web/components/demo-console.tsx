'use client';

import type {
  AgentAction,
  AuthorizedIntent,
  ExecutionReceipt,
  IntentPolicy,
  PolicyCheck,
} from '@intentproof/intent-schema';
import { computeIntentHash } from '@intentproof/intent-schema';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { shortHash, timestamp, usd } from '@/lib/format';
import { PolicyEditor } from './policy-editor';
import { PolicyView } from './policy-view';
import { Badge, Callout, Panel, PanelHeader, SectionLabel, buttonClass } from './ui';

const EXAMPLE = `Manage my Starknet portfolio. You may swap ETH and STRK. Never use leverage or borrowing. Never interact with unknown contracts. Maximum transaction value is $500. Maximum daily spending is $1,000. Only use approved DEXs. Authorization expires after 24 hours.`;

const ALTERNATIVES = [
  {
    label: 'Tight mandate',
    text: 'Swap ETH and STRK when appropriate. Never spend more than $250 per transaction or $500 a day. Never use leverage. Only use approved protocols. Expires in 12 hours.',
  },
  {
    label: 'Staking mandate',
    text: 'You may swap and stake STRK on approved venues. Do not borrow, do not use leverage, do not send funds anywhere. Cap each transaction at $300 and each day at $900. Expires in 48 hours.',
  },
];

type Stage = 'describe' | 'review' | 'authorized' | 'ran' | 'verified';

interface Provenance {
  compilerId: string;
  kind: 'llm' | 'deterministic';
  model: string | null;
  isModelGenerated: boolean;
  createdAt: string;
  durationMs: number;
}

interface CompileResponse {
  policy: IntentPolicy;
  provenance: Provenance;
  warnings: string[];
  preview: { intentHash: string; canonical: string; chunkCount: number };
}

interface Outcome {
  action: AgentAction;
  allowed: boolean;
  checks: PolicyCheck[];
  reasons: string[];
  failedChecks: string[];
  receipt: ExecutionReceipt;
  anchor: { transactionHash: string; explorerUrl: string } | null;
}

interface RunResponse {
  outcomes: Outcome[];
  summary: {
    evaluated: number;
    allowed: number;
    rejected: number;
    unauthorizedExecutions: number;
  };
  strategy: { displayName: string; description: string };
}

interface VerifyFinding {
  name: string;
  title: string;
  passed: boolean | null;
  detail: string;
}

interface VerifyEntry {
  receiptHash: string;
  verdict: string;
  findings: VerifyFinding[];
}

const STAGES: { id: Stage; label: string }[] = [
  { id: 'describe', label: 'Describe' },
  { id: 'review', label: 'Review' },
  { id: 'authorized', label: 'Authorize' },
  { id: 'ran', label: 'Run agent' },
  { id: 'verified', label: 'Verify' },
];

function Stepper({ stage }: { stage: Stage }) {
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-3 text-[11px]">
      {STAGES.map((item, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={item.id} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 font-mono uppercase tracking-[0.12em] ${
                state === 'active'
                  ? 'text-accent'
                  : state === 'done'
                    ? 'text-allow'
                    : 'text-text-faint'
              }`}
            >
              <span aria-hidden>{state === 'done' ? '✓' : String(index + 1)}</span>
              {item.label}
            </span>
            {index < STAGES.length - 1 ? (
              <span aria-hidden className="text-text-faint">
                ·
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function CheckList({ checks }: { checks: PolicyCheck[] }) {
  return (
    <ul className="divide-y divide-line/50">
      {checks.map((check) => (
        <li key={check.name} className="flex items-start gap-3 px-4 py-2">
          <span
            aria-hidden
            className={`mt-0.5 font-mono text-[11px] ${check.passed ? 'text-allow' : 'text-reject'}`}
          >
            {check.passed ? '✓' : '✗'}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[11.5px] text-text">
              {check.name}
              <span className="sr-only">{check.passed ? ' passed' : ' failed'}</span>
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-text-dim">{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OutcomeRow({ outcome }: { outcome: Outcome }) {
  const [open, setOpen] = useState(false);
  const { action } = outcome;
  const label =
    action.kind === 'swap'
      ? `${action.assetIn} → ${action.assetOut}`
      : action.kind === 'transfer'
        ? `${action.assetIn} → ${shortHash(action.destination ?? '', 8, 4)}`
        : `${action.kind} ${action.assetOut ?? action.assetIn ?? ''}`;

  return (
    <li className="border-b border-line/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2"
      >
        <span className="w-full min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[12.5px] text-text">
              {action.kind.replace(/_/gu, ' ')} {label}
            </span>
            <span className="font-mono text-[12px] text-text-dim">{usd(action.valueUsd)}</span>
          </span>
          {!outcome.allowed && outcome.reasons[0] ? (
            <span className="mt-1 block text-[12px] leading-relaxed text-text-dim">
              {outcome.reasons[0]}
              {outcome.reasons.length > 1 ? (
                <span className="text-text-faint"> +{outcome.reasons.length - 1} more</span>
              ) : null}
            </span>
          ) : null}
        </span>
        <Badge tone={outcome.allowed ? 'allow' : 'reject'}>
          {outcome.allowed ? '✓ Allowed' : '✗ Rejected'}
        </Badge>
        <span aria-hidden className="font-mono text-[11px] text-text-faint">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="border-t border-line/60 bg-ink/40">
          <CheckList checks={outcome.checks} />
          <div className="border-t border-line/60 px-4 py-2.5">
            <SectionLabel>Receipt hash</SectionLabel>
            <p className="mt-1 hash text-text-dim">{outcome.receipt.receiptHash}</p>
            {outcome.anchor ? (
              <a
                href={outcome.anchor.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-block hash text-accent underline decoration-accent-dim underline-offset-2"
              >
                {outcome.anchor.transactionHash} ↗
              </a>
            ) : (
              <p className="mt-1.5 text-[12px] text-text-faint">
                No transaction: this receipt was produced in local demo mode.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function DemoConsole({ localMode }: { localMode: boolean }) {
  const [stage, setStage] = useState<Stage>('describe');
  const [input, setInput] = useState(EXAMPLE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);

  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [draft, setDraft] = useState<IntentPolicy | null>(null);
  const [editing, setEditing] = useState(false);
  const [intent, setIntent] = useState<AuthorizedIntent | null>(null);
  const [displayNumber, setDisplayNumber] = useState<string>('');
  const [run, setRun] = useState<RunResponse | null>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [verifications, setVerifications] = useState<VerifyEntry[] | null>(null);

  const call = useCallback(
    async <T,>(url: string, body: unknown, label: string): Promise<T | null> => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as T & { error?: string; issues?: string[] };
        if (!response.ok) {
          setError({ message: payload.error ?? 'Request failed.', issues: payload.issues });
          return null;
        }
        return payload;
      } catch {
        setError({ message: 'Could not reach the server.' });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const compile = async () => {
    const result = await call<CompileResponse>(
      '/api/compile',
      { naturalLanguage: input },
      'compile',
    );
    if (!result) return;
    setCompiled(result);
    setDraft(result.policy);
    setEditing(false);
    setStage('review');
  };

  const authorize = async () => {
    if (!draft || !compiled) return;
    const result = await call<{ intent: AuthorizedIntent; displayNumber: string }>(
      '/api/intents',
      {
        policy: draft,
        sourceText: input,
        compiler: compiled.provenance,
        warnings: compiled.warnings,
      },
      'authorize',
    );
    if (!result) return;
    setIntent(result.intent);
    setDisplayNumber(result.displayNumber);
    setStage('authorized');
  };

  const runAgent = async () => {
    if (!intent) return;
    const result = await call<RunResponse>(
      `/api/intents/${intent.intentId}/run`,
      { strategy: 'scenario' },
      'run',
    );
    if (!result) return;
    setRun(result);
    setStage('ran');
  };

  const verifyAll = async () => {
    if (!intent || !run) return;
    setBusy('verify');
    setError(null);
    const entries: VerifyEntry[] = [];
    for (const outcome of run.outcomes) {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ receiptHash: outcome.receipt.receiptHash }),
      });
      const payload = (await response.json()) as {
        report?: { verdict: string; findings: VerifyFinding[] };
        error?: string;
      };
      if (!response.ok || !payload.report) {
        setError({ message: payload.error ?? 'Verification failed.' });
        setBusy(null);
        return;
      }
      entries.push({
        receiptHash: outcome.receipt.receiptHash,
        verdict: payload.report.verdict,
        findings: payload.report.findings,
      });
    }
    setVerifications(entries);
    setStage('verified');
    setBusy(null);
  };

  const reset = () => {
    setStage('describe');
    setCompiled(null);
    setDraft(null);
    setIntent(null);
    setRun(null);
    setVerifications(null);
    setReceiptsOpen(false);
    setError(null);
  };

  // The hash of what is *about to be committed*, which is the draft after any
  // edits — not the one the compiler originally returned. Showing the stale value
  // here would undercut the exact claim the screen is making.
  const draftHash = useMemo(() => {
    if (!draft) return null;
    try {
      return computeIntentHash(draft);
    } catch {
      return null;
    }
  }, [draft]);

  const summary = run?.summary;
  const allVerified = useMemo(
    () => verifications?.every((v) => v.findings.every((f) => f.passed !== false)) ?? false,
    [verifications],
  );

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line bg-panel-2">
        <Stepper stage={stage} />
      </div>

      {error ? (
        <div className="border-b border-reject/30 bg-reject-dim/30 px-4 py-3" role="alert">
          <p className="text-[13px] font-medium text-reject">{error.message}</p>
          {error.issues?.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {error.issues.map((issue) => (
                <li key={issue} className="font-mono text-[11.5px] text-reject/80">
                  · {issue}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ---------- 1. Describe ---------- */}
      {stage === 'describe' ? (
        <div className="px-4 py-4">
          <label htmlFor="intent-input" className="block">
            <SectionLabel>Describe what the agent may do</SectionLabel>
          </label>
          <textarea
            id="intent-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={5}
            maxLength={4000}
            className="mt-2 w-full resize-y rounded border border-line-strong bg-ink px-3 py-2.5 text-[13.5px] leading-relaxed text-text outline-none focus:border-accent-dim"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-text-faint">Try:</span>
            {ALTERNATIVES.map((alt) => (
              <button
                key={alt.label}
                type="button"
                onClick={() => setInput(alt.text)}
                className="rounded border border-line-strong bg-panel-2 px-2 py-1 text-[11.5px] text-text-dim hover:text-text"
              >
                {alt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setInput(EXAMPLE)}
              className="rounded border border-line-strong bg-panel-2 px-2 py-1 text-[11.5px] text-text-dim hover:text-text"
            >
              Reset
            </button>
            <span className="ml-auto font-mono text-[11px] text-text-faint">
              {input.length}/4000
            </span>
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={compile}
              disabled={busy !== null || input.trim().length < 10}
              className={buttonClass.primary}
            >
              {busy === 'compile' ? 'Compiling…' : 'Compile intent'}
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- 2. Review ---------- */}
      {stage === 'review' && compiled && draft ? (
        <div className="animate-in">
          <PanelHeader
            title={compiled.provenance.isModelGenerated ? 'AI interpretation' : 'Rule-based interpretation'}
            meta={
              compiled.provenance.isModelGenerated
                ? `${compiled.provenance.model} · ${compiled.provenance.durationMs} ms`
                : 'No language model was involved'
            }
          >
            <Badge tone={compiled.provenance.isModelGenerated ? 'accent' : 'warn'}>
              {compiled.provenance.isModelGenerated ? 'Model output' : 'Deterministic parser'}
            </Badge>
          </PanelHeader>

          <div className="border-b border-line px-4 py-3">
            <Callout tone="warn" title="Review this before authorizing.">
              {compiled.provenance.isModelGenerated
                ? 'A language model wrote this interpretation of your words. It can be wrong, and nothing below is enforced until you approve it. Check the refusals as carefully as the permissions.'
                : 'A rule-based parser wrote this interpretation — not an AI. It is even blunter than a model would be. Check it line by line.'}
            </Callout>
          </div>

          {compiled.warnings.length > 0 ? (
            <ul className="space-y-1.5 border-b border-line px-4 py-3">
              {compiled.warnings.map((warning) => (
                <li key={warning} className="text-[12.5px] leading-relaxed text-warn">
                  ⚠ {warning}
                </li>
              ))}
            </ul>
          ) : null}

          {editing ? (
            <PolicyEditor policy={draft} onChange={setDraft} />
          ) : (
            <PolicyView policy={draft} />
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button
              type="button"
              onClick={authorize}
              disabled={busy !== null}
              className={buttonClass.primary}
            >
              {busy === 'authorize' ? 'Committing…' : 'Approve intent'}
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={buttonClass.secondary}
            >
              {editing ? 'Done editing' : 'Edit intent'}
            </button>
            <button type="button" onClick={reset} className={buttonClass.ghost}>
              Reject
            </button>
            <span className="ml-auto flex items-baseline gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
                will commit
              </span>
              <span className="hash text-text-dim" aria-live="polite">
                {draftHash ? shortHash(draftHash, 14, 8) : 'invalid policy'}
              </span>
            </span>
          </div>
        </div>
      ) : null}

      {/* ---------- 3. Authorized ---------- */}
      {(stage === 'authorized' || stage === 'ran' || stage === 'verified') && intent ? (
        <div className="animate-in border-b border-line">
          <PanelHeader title={`Intent ${displayNumber}`} meta={intent.policy.purpose}>
            <Badge tone={intent.revokedAt ? 'reject' : 'allow'}>
              {intent.revokedAt ? 'Revoked' : 'Authorized'}
            </Badge>
          </PanelHeader>
          <dl className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                Intent hash
              </dt>
              <dd className="mt-0.5 hash text-text">{intent.intentHash}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                Network
              </dt>
              <dd className="mt-0.5 text-[13px]">{intent.network}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                Expires
              </dt>
              <dd className="mt-0.5 text-[13px]">{timestamp(intent.expiresAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                Transaction
              </dt>
              <dd className="mt-0.5">
                {intent.anchor ? (
                  <a
                    href={intent.anchor.explorerUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hash text-accent underline decoration-accent-dim underline-offset-2"
                  >
                    {intent.anchor.transactionHash} ↗
                  </a>
                ) : (
                  <span className="text-[13px] text-warn">
                    LOCAL DEMO MODE — this commitment was computed, not broadcast. There is no
                    transaction and none is shown.
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {stage === 'authorized' ? (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={runAgent}
                disabled={busy !== null}
                className={buttonClass.primary}
              >
                {busy === 'run' ? 'Running agent…' : 'Run agent'}
              </button>
              <Link href={`/intents/${intent.intentId}`} className={buttonClass.secondary}>
                Open intent page
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- 4. Agent run ---------- */}
      {(stage === 'ran' || stage === 'verified') && run && summary ? (
        <div className="animate-in">
          <PanelHeader title="Agent proposals" meta={run.strategy.description}>
            <span className="font-mono text-[11px] text-text-faint">
              {summary.allowed} allowed · {summary.rejected} rejected
            </span>
          </PanelHeader>
          <ul>
            {run.outcomes.map((outcome) => (
              <OutcomeRow key={outcome.receipt.receiptHash} outcome={outcome} />
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button
              type="button"
              onClick={() => setReceiptsOpen((v) => !v)}
              className={buttonClass.secondary}
            >
              {receiptsOpen ? 'Hide receipts' : 'Inspect receipts'}
            </button>
            {stage === 'ran' ? (
              <button
                type="button"
                onClick={verifyAll}
                disabled={busy !== null}
                className={buttonClass.primary}
              >
                {busy === 'verify' ? 'Verifying…' : 'Verify'}
              </button>
            ) : null}
          </div>

          {receiptsOpen ? (
            <div className="border-t border-line px-4 py-3">
              <p className="text-[12.5px] leading-relaxed text-text-dim">
                Receipts are sealed at the moment the decision is made, not generated afterwards —
                which is why a rejection has one too. Each hash below commits to the intent, the
                action and the full check list.
              </p>
              <ul className="mt-3 space-y-2">
                {run.outcomes.map((outcome) => (
                  <li
                    key={outcome.receipt.receiptHash}
                    className="rounded border border-line bg-panel-2 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={outcome.allowed ? 'allow' : 'reject'}>
                        {outcome.receipt.policyResult}
                      </Badge>
                      <span className="font-mono text-[11px] text-text-faint">
                        {outcome.receipt.actionId}
                      </span>
                    </div>
                    <p className="mt-1.5 hash text-text-dim">{outcome.receipt.receiptHash}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- 5. Verification ---------- */}
      {stage === 'verified' && verifications && summary ? (
        <div className="animate-in border-t border-line">
          <PanelHeader title="Independent verification" meta="Every hash recomputed, every decision re-run" />
          <div className="grid gap-px border-y border-line bg-line sm:grid-cols-4">
            {[
              { label: 'Actions evaluated', value: String(summary.evaluated), tone: 'text-text' },
              { label: 'Allowed', value: String(summary.allowed), tone: 'text-allow' },
              { label: 'Rejected', value: String(summary.rejected), tone: 'text-reject' },
              {
                label: 'Unauthorized executions',
                value: String(summary.unauthorizedExecutions),
                tone: summary.unauthorizedExecutions === 0 ? 'text-allow' : 'text-reject',
              },
            ].map((stat) => (
              <div key={stat.label} className="bg-panel px-4 py-4">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
                  {stat.label}
                </p>
                <p className={`mt-1.5 font-mono text-2xl ${stat.tone}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="px-4 py-4">
            <p
              className={`text-lg font-semibold tracking-tight ${allVerified ? 'text-allow' : 'text-reject'}`}
            >
              {allVerified ? 'Execution remained within authorized intent' : 'Verification failed'}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">
              {allVerified
                ? `All ${verifications.length} receipts re-verify: the commitment still matches the policy, the recorded actions match their hashes, and re-running the policy engine at each receipt's own timestamp reproduces exactly the verdict it claims.`
                : 'At least one receipt did not reproduce. See the findings below.'}
            </p>
            {localMode ? (
              <p className="mt-3 text-[12.5px] leading-relaxed text-warn">
                Local demo mode: the verdict on each receipt is <strong>INDETERMINATE</strong>, not
                &ldquo;proven on chain&rdquo;. Every local check passed, but no Starknet registry was
                consulted because none is configured. Configure{' '}
                <code className="font-mono">INTENT_REGISTRY_ADDRESS</code> to get a chain-confirmed
                verdict.
              </p>
            ) : null}

            <ul className="mt-4 space-y-2">
              {verifications.map((entry, index) => (
                <li key={entry.receiptHash} className="rounded border border-line bg-panel-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-text-faint">#{index + 1}</span>
                    <Badge
                      tone={
                        entry.verdict === 'EXECUTION_WITHIN_INTENT'
                          ? 'allow'
                          : entry.verdict === 'INDETERMINATE'
                            ? 'warn'
                            : 'reject'
                      }
                    >
                      {entry.verdict.replace(/_/gu, ' ')}
                    </Badge>
                    <span className="hash text-text-faint">
                      {shortHash(entry.receiptHash, 12, 8)}
                    </span>
                  </div>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {entry.findings.map((finding) => (
                      <li key={finding.name} className="flex items-start gap-2 text-[12px]">
                        <span
                          aria-hidden
                          className={
                            finding.passed === true
                              ? 'text-allow'
                              : finding.passed === false
                                ? 'text-reject'
                                : 'text-warn'
                          }
                        >
                          {finding.passed === true ? '✓' : finding.passed === false ? '✗' : '○'}
                        </span>
                        <span className="text-text-dim">{finding.title}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-wrap gap-2">
              {intent ? (
                <Link href={`/intents/${intent.intentId}`} className={buttonClass.secondary}>
                  Full intent record
                </Link>
              ) : null}
              <Link href="/verify" className={buttonClass.secondary}>
                Verify a hash yourself
              </Link>
              <button type="button" onClick={reset} className={buttonClass.ghost}>
                Start over
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
