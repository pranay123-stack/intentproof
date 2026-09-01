import type { Metadata } from 'next';
import { DemoConsole } from '@/components/demo-console';
import { ModeBanner } from '@/components/mode-banner';
import { PageHeader, Panel, SectionLabel } from '@/components/ui';
import { runtimeStatus } from '@/lib/server';

export const metadata: Metadata = {
  title: 'Demo',
  description:
    'Compile a natural-language mandate into a policy, commit it, and watch a deterministic engine refuse the actions that fall outside it.',
};

const STEPS = [
  {
    title: '1 · Describe',
    body: 'Write what the agent may and may not do, in ordinary language. Nothing is sent anywhere until you press compile.',
  },
  {
    title: '2 · Review',
    body: 'The compiler returns a structured policy. Read it, edit any limit, and watch the commitment change as you do.',
  },
  {
    title: '3 · Authorize',
    body: 'Approving canonicalizes the policy, hashes it with Poseidon, and registers it — on Starknet when configured, locally otherwise.',
  },
  {
    title: '4 · Run agent',
    body: 'A simulated agent proposes seven actions. It has no access to the policy engine and cannot see a verdict before proposing.',
  },
  {
    title: '5 · Verify',
    body: 'Every receipt is re-checked from scratch: hashes recomputed, the engine re-run at the receipt’s own timestamp.',
  },
];

export default function DemoPage() {
  const status = runtimeStatus();
  return (
    <>
      <PageHeader
        eyebrow="Live demo"
        title="From a sentence to an enforced authorization"
        lede="The full pipeline, running for real. The only thing that changes between this and a production deployment is whether a Starknet registry address is configured."
      >
        <div className="max-w-2xl">
          <ModeBanner />
        </div>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <DemoConsole localMode={status.registry.mode === 'LOCAL_DEMO'} />

          <aside className="space-y-3">
            <SectionLabel>What happens at each step</SectionLabel>
            {STEPS.map((step) => (
              <Panel key={step.title} className="p-3.5">
                <p className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-accent">
                  {step.title}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">{step.body}</p>
              </Panel>
            ))}
          </aside>
        </div>
      </div>
    </>
  );
}
