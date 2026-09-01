import type { Metadata } from 'next';
import Link from 'next/link';
import { intentDisplayNumber, intentStatus } from '@intentproof/sdk';
import { shortHash, timestamp } from '@/lib/format';
import { Badge, ButtonLink, EmptyState, PageHeader, Panel } from '@/components/ui';
import { intentStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Intents',
  description: 'Every authorization committed on this deployment, with its execution history.',
};

export default function IntentsPage() {
  const records = intentStore().list();

  return (
    <>
      <PageHeader
        eyebrow="Registry"
        title="Authorized intents"
        lede="Each row is a policy a human approved, its Poseidon commitment, and what an agent has done under it since."
      >
        <ButtonLink href="/demo" variant="primary">
          Create an intent
        </ButtonLink>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-5 py-10">
        {records.length === 0 ? (
          <Panel>
            <EmptyState
              title="No intents yet"
              action={
                <ButtonLink href="/demo" variant="primary">
                  Run the demo
                </ButtonLink>
              }
            >
              Intents appear here once a policy has been compiled, reviewed and approved. Nothing is
              seeded — this list only ever shows authorizations that actually happened on this
              deployment.
            </EmptyState>
          </Panel>
        ) : (
          <ul className="space-y-3">
            {records.map((record) => {
              const status = intentStatus(record.intent);
              const allowed = record.receipts.filter((r) => r.policyResult === 'ALLOWED').length;
              const rejected = record.receipts.length - allowed;
              return (
                <li key={record.intent.intentId}>
                  <Link
                    href={`/intents/${record.intent.intentId}`}
                    className="block rounded-lg border border-line bg-panel p-4 transition-colors hover:border-line-strong"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-[13px] text-text">
                        Intent {intentDisplayNumber(record.intent)}
                      </span>
                      <Badge
                        tone={
                          status === 'ACTIVE' ? 'allow' : status === 'REVOKED' ? 'reject' : 'warn'
                        }
                      >
                        {status}
                      </Badge>
                      <Badge tone={record.intent.anchor ? 'accent' : 'warn'}>
                        {record.intent.anchor ? 'On chain' : 'Local demo'}
                      </Badge>
                      <Badge tone={record.compiler.isModelGenerated ? 'accent' : 'neutral'}>
                        {record.compiler.isModelGenerated
                          ? (record.compiler.model ?? 'model')
                          : 'rule-based'}
                      </Badge>
                      <span className="ml-auto font-mono text-[11.5px] text-text-faint">
                        {allowed} allowed · {rejected} rejected
                      </span>
                    </div>
                    <p className="mt-2 hash text-text-dim">
                      {shortHash(record.intent.intentHash, 30, 14)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-text-faint">
                      <span>{record.intent.policy.purpose}</span>
                      <span>created {timestamp(record.intent.createdAt)}</span>
                      <span>expires {timestamp(record.intent.expiresAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
