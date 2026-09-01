import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dayIndex, intentDisplayNumber, intentStatus } from '@intentproof/sdk';
import { IntentActions } from '@/components/intent-actions';
import { PolicyView } from '@/components/policy-view';
import {
  Badge,
  ButtonLink,
  Callout,
  EmptyState,
  Hash,
  KeyValue,
  Panel,
  PanelHeader,
  SectionLabel,
} from '@/components/ui';
import { shortHash, timestamp, usd } from '@/lib/format';
import { intentStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const record = intentStore().find(id);
  return {
    title: record ? `Intent ${intentDisplayNumber(record.intent)}` : 'Intent not found',
  };
}

export default async function IntentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = intentStore().find(id);
  if (!record) notFound();

  const { intent, receipts, compiler, warnings, sourceText } = record;
  const status = intentStatus(intent);
  const allowed = receipts.filter((r) => r.policyResult === 'ALLOWED');
  const rejected = receipts.filter((r) => r.policyResult === 'REJECTED');
  // Only receipts from the current UTC day count, matching the bucket the engine
  // and the contract both use. Summing every allowed receipt ever would show a
  // number the policy never enforced.
  const today = dayIndex(new Date());
  const spentToday = allowed
    .filter((r) => dayIndex(new Date(r.timestamp)) === today)
    .reduce((sum, r) => sum + r.action.valueUsd, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <nav aria-label="Breadcrumb" className="mb-5 text-[12.5px] text-text-dim">
        <Link href="/intents" className="hover:text-text">
          Intents
        </Link>
        <span aria-hidden className="px-2 text-text-faint">
          /
        </span>
        <span className="font-mono text-text">{intentDisplayNumber(intent)}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Intent <span className="font-mono">{intentDisplayNumber(intent)}</span>
        </h1>
        <Badge tone={status === 'ACTIVE' ? 'allow' : status === 'REVOKED' ? 'reject' : 'warn'}>
          {status}
        </Badge>
        <Badge tone={intent.anchor ? 'accent' : 'warn'}>
          {intent.anchor ? 'Committed on Starknet' : 'Local demo mode'}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Commitment" meta="Everything below is recomputable from the policy" />
            <dl>
              <KeyValue label="Intent hash" mono>
                {intent.intentHash}
              </KeyValue>
              <KeyValue label="Intent id" mono>
                {intent.intentId}
              </KeyValue>
              <KeyValue label="Creator" mono>
                {intent.creator}
              </KeyValue>
              <KeyValue label="Agent" mono>
                {intent.agentId}
              </KeyValue>
              <KeyValue label="Created">{timestamp(intent.createdAt)}</KeyValue>
              <KeyValue label="Expires">{timestamp(intent.expiresAt)}</KeyValue>
              <KeyValue label="Network" mono>
                {intent.network}
              </KeyValue>
              <KeyValue label="Transaction">
                {intent.anchor ? (
                  <Hash value={intent.anchor.transactionHash} href={intent.anchor.explorerUrl} />
                ) : (
                  <span className="text-warn">
                    None. This intent was committed in local demo mode — the hash is real, the chain
                    write never happened, and no transaction is invented to fill the gap.
                  </span>
                )}
              </KeyValue>
              {intent.revokedAt ? (
                <KeyValue label="Revoked at">
                  <span className="text-reject">{timestamp(intent.revokedAt)}</span>
                </KeyValue>
              ) : null}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader
              title="Policy"
              meta="The authorization document the engine enforces, verbatim"
            />
            <PolicyView policy={intent.policy} />
          </Panel>

          <Panel>
            <PanelHeader
              title="Execution history"
              meta={`${receipts.length} evaluated · ${allowed.length} allowed · ${rejected.length} rejected`}
            />
            {receipts.length === 0 ? (
              <EmptyState title="No actions evaluated yet">
                Run the agent to see what it proposes and what the policy engine does about it. Both
                outcomes produce a receipt.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line/60">
                {receipts.map((receipt, index) => {
                  const failed = receipt.checks.filter((c) => !c.passed);
                  return (
                    <li key={receipt.receiptHash} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-[11px] text-text-faint">
                          #{String(index + 1).padStart(3, '0')}
                        </span>
                        <span className="font-mono text-[12.5px] text-text">
                          {receipt.action.kind.replace(/_/gu, ' ')}
                          {receipt.action.assetIn ? ` ${receipt.action.assetIn}` : ''}
                          {receipt.action.assetOut ? ` → ${receipt.action.assetOut}` : ''}
                        </span>
                        <span className="font-mono text-[12px] text-text-dim">
                          {usd(receipt.action.valueUsd)}
                        </span>
                        <Badge tone={receipt.policyResult === 'ALLOWED' ? 'allow' : 'reject'}>
                          {receipt.policyResult}
                        </Badge>
                        <span className="ml-auto font-mono text-[11px] text-text-faint">
                          {timestamp(receipt.timestamp)}
                        </span>
                      </div>

                      {failed.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {failed.map((check) => (
                            <li key={check.name} className="text-[12px] leading-relaxed text-reject">
                              ✗ <span className="font-mono">{check.name}</span> — {check.detail}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="hash text-text-faint">
                          receipt {shortHash(receipt.receiptHash, 14, 8)}
                        </span>
                        {receipt.transactionHash ? (
                          <Hash value={shortHash(receipt.transactionHash, 14, 8)} />
                        ) : (
                          <span className="font-mono text-[11px] text-text-faint">no tx</span>
                        )}
                        <Link
                          href={`/verify?receiptHash=${receipt.receiptHash}`}
                          className="text-[12px] text-accent underline decoration-accent-dim underline-offset-2"
                        >
                          Verify
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel className="p-4">
            <SectionLabel>Actions</SectionLabel>
            <div className="mt-3">
              <IntentActions
                intentId={intent.intentId}
                revoked={intent.revokedAt !== null}
                expired={status === 'EXPIRED'}
              />
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionLabel>Budget used today</SectionLabel>
            <p className="mt-2 font-mono text-xl text-text">
              {usd(spentToday)}
              <span className="text-text-faint"> / {usd(intent.policy.maxDailySpendUsd)}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full bg-accent"
                style={{
                  width: `${Math.min(100, (spentToday / (intent.policy.maxDailySpendUsd || 1)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-text-dim">
              Counted over the current UTC day, the same bucket the engine and the contract use.
              Only allowed actions consume budget; rejections cost nothing.
            </p>
          </Panel>

          <Panel className="p-4">
            <SectionLabel>Provenance</SectionLabel>
            <dl className="mt-3 space-y-2 text-[12.5px]">
              <div>
                <dt className="text-text-faint">Compiler</dt>
                <dd className="font-mono text-text">{compiler.compilerId}</dd>
              </div>
              <div>
                <dt className="text-text-faint">Model</dt>
                <dd className="font-mono text-text">
                  {compiler.isModelGenerated ? compiler.model : 'none — rule-based parser'}
                </dd>
              </div>
            </dl>
            {sourceText ? (
              <>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                  Original words
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-dim">
                  {sourceText}
                </p>
              </>
            ) : null}
          </Panel>

          {warnings.length > 0 ? (
            <Callout tone="warn" title="Flagged at compile time">
              <ul className="mt-1 space-y-1">
                {warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <ButtonLink href={`/verify?intentHash=${intent.intentHash}`}>
            Verify this intent
          </ButtonLink>
        </aside>
      </div>
    </div>
  );
}
