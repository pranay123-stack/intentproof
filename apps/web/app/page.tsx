import Link from 'next/link';
import { DemoConsole } from '@/components/demo-console';
import { ModeBanner } from '@/components/mode-banner';
import { CORE_PIPELINE, Pipeline } from '@/components/pipeline';
import { Badge, ButtonLink, Panel, SectionLabel } from '@/components/ui';
import { runtimeStatus } from '@/lib/server';

export default function HomePage() {
  const status = runtimeStatus();
  const github = process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com';

  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <Badge tone="accent">Starknet Seed Grant · experimental MVP</Badge>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Prove that autonomous agents did what humans actually authorized.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-dim">
            An open verification layer for intent-driven AI agents on Starknet.
          </p>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-dim">
            A model reads what you wrote and proposes a policy. You approve it. From that moment the
            model has no say: a deterministic engine decides every action, the commitment lives on
            Starknet, and every decision — including every refusal — leaves a receipt anyone can
            recompute.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="#demo" variant="primary">
              Try live demo
            </ButtonLink>
            <ButtonLink href="/architecture">View architecture</ButtonLink>
            <ButtonLink href={github} external>
              GitHub ↗
            </ButtonLink>
          </div>

          <div className="mt-10 max-w-2xl">
            <ModeBanner />
          </div>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <SectionLabel>The problem</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              &ldquo;I told it not to do that&rdquo; is not evidence.
            </h2>
            <div className="mt-5 max-w-2xl space-y-4 text-[15px] leading-relaxed text-text-dim">
              <p>
                Agents can already hold keys, sign transactions and chain multi-step strategies
                across protocols. What they cannot do is prove afterwards that they stayed inside
                what a person asked for. A wallet limit stops a large transfer; it does not know
                that you said <em>never use leverage</em>.
              </p>
              <p>
                The instinctive fix — ask the model to check itself — puts the same untrusted
                component on both sides of the boundary. A model that misread the instruction will
                misread it again when asked to audit its own work, and a model that was
                prompt-injected will report success.
              </p>
              <p className="text-text">
                IntentProof separates the two roles. The model interprets. A deterministic engine
                decides. Starknet holds the commitment neither of them can quietly edit.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              {
                title: 'The model cannot widen a grant',
                body: 'Action kinds are a closed enum, protocols come from a directory, and limits are required. An invented permission fails schema validation before a human ever sees it.',
              },
              {
                title: 'The commitment covers what you read',
                body: 'The hash is taken over the canonical policy including the explanation you were shown, so nobody can display one interpretation and commit to another.',
              },
              {
                title: 'Refusals are recorded too',
                body: 'Every evaluated action produces a sealed receipt. What the agent tried and was stopped from doing is as much a part of the record as what it did.',
              },
            ].map((item) => (
              <Panel key={item.title} className="p-4">
                <p className="text-[13.5px] font-medium text-text">{item.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">{item.body}</p>
              </Panel>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <SectionLabel>The path an instruction takes</SectionLabel>
          <div className="mt-6 grid gap-8 lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start">
            <Pipeline nodes={CORE_PIPELINE} />
            <div className="space-y-5 text-[14.5px] leading-relaxed text-text-dim">
              <p>
                Two steps are coloured differently on purpose. The amber steps are the ones nobody
                should have to trust: a language model interpreting prose, and an agent deciding what
                it would like to do next. The green step is the only authority in the system.
              </p>
              <p>
                Between them sit two gates and a human. Schema validation refuses output that does
                not match a closed structure. Semantic validation refuses policies that are
                well-formed but unbounded — no spending cap, no expiry, transfer permission with no
                destination list. Then a person reads it and clicks approve.
              </p>
              <p>
                Only after that is anything committed. And once it is, the policy that gets enforced
                is the one the hash covers: edit it afterwards and the commitment stops matching,
                which the verification page will tell you in plain language.
              </p>
              <p className="text-text">
                <Link href="/architecture" className="text-accent underline decoration-accent-dim underline-offset-2">
                  Read the full architecture →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="demo" className="scroll-mt-20 border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <SectionLabel>Live demo</SectionLabel>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Describe a mandate, then watch an agent try to exceed it.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-dim">
            This runs the real pipeline.{' '}
            {status.compiler.isModelGenerated
              ? `Your text goes to ${status.compiler.model}, which returns a structured proposal.`
              : 'No OpenAI key is configured on this deployment, so a rule-based parser drafts the policy and the interface says so at every step.'}{' '}
            The policy engine, the hashing and the receipts are the same code either way.
          </p>

          <div className="mt-8">
            <DemoConsole localMode={status.registry.mode === 'LOCAL_DEMO'} />
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-14">
          <SectionLabel>What this is not</SectionLabel>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Not a zero-knowledge proof',
                body: 'IntentProof produces a verifiable execution receipt: a cryptographic commitment plus a deterministic re-derivation. No proof system is implemented, and none is claimed. The design leaves room for one.',
              },
              {
                title: 'Not audited',
                body: 'This is an experimental MVP written for a grant application. It has had no independent security review and should not guard real funds.',
              },
              {
                title: 'Not a guarantee the model is right',
                body: 'A model can still misread you. What the system guarantees is that a misreading has to pass a human, and that whatever was approved is exactly what gets enforced.',
              },
            ].map((item) => (
              <Panel key={item.title} className="p-4">
                <p className="text-[13.5px] font-medium text-text">{item.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">{item.body}</p>
              </Panel>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
