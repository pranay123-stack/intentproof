import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, Callout, PageHeader, Panel, Prose, SectionLabel } from '@/components/ui';

export const metadata: Metadata = {
  title: 'About',
  description: 'Why IntentProof exists, what it is for, and what a Starknet Seed Grant would fund.',
};

export default function AboutPage() {
  const github = process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com';
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="An authorization boundary between human intent and autonomous execution"
        lede="IntentProof was built as the working core of a Starknet Seed Grant application. It is an MVP, and the pages describing what it cannot do are as carefully written as the ones describing what it can."
      />

      <div className="mx-auto max-w-4xl px-5 py-12 space-y-12">
        <section>
          <h2 className="text-xl font-semibold tracking-tight">The problem, stated plainly</h2>
          <Prose>
            <p className="mt-3">
              Autonomous agents are increasingly capable of controlling blockchain accounts and
              executing multi-step transactions. Users can already set wallet limits — a maximum
              transfer, an allowlist of addresses — but those limits speak a different language from
              the one people use. Nobody says &ldquo;cap outbound ERC-20 transfers at 500 USD
              equivalent&rdquo;. They say <em>manage my portfolio, but never use leverage</em>.
            </p>
            <p>
              Natural-language intent is hard to represent and harder to verify. It is also exactly
              where the disputes will be: not &ldquo;did the transaction happen&rdquo;, which the
              chain already answers, but &ldquo;was it what I asked for&rdquo;, which nothing
              currently answers at all.
            </p>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">The approach</h2>
          <Prose>
            <p className="mt-3">
              Put a deterministic boundary between the two. A language model is good at reading prose
              and bad at being an authority, so it is used for the first and excluded from the
              second. Its output becomes a structured policy, which a human approves, which is
              committed as a hash, which a deterministic engine then enforces without ever consulting
              a model again.
            </p>
            <p>
              The result is not a smarter agent. It is an agent whose behaviour can be checked
              afterwards by someone who trusts neither the agent nor the person running it.
            </p>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Why Starknet</h2>
          <Prose>
            <ul className="mt-3 space-y-2">
              <li>
                <strong>Cairo has Poseidon natively.</strong> The commitment scheme is not bolted on:
                the contract recomputes the same hash the client computed, from the same canonical
                bytes, using a primitive the VM already has.
              </li>
              <li>
                <strong>Cheap execution makes per-action recording viable.</strong> An authorization
                layer that costs more than the trades it guards would not get used.
              </li>
              <li>
                <strong>Account abstraction is native.</strong> The natural next step — putting the
                policy engine inside the account&rsquo;s validation path — is a normal thing to build
                on Starknet and awkward everywhere else.
              </li>
              <li>
                <strong>The proving infrastructure already exists.</strong> Phase 2 needs a verifier
                on chain, and Starknet is a chain built around one.
              </li>
            </ul>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Why OpenAI</h2>
          <Prose>
            <p className="mt-3">
              Because interpreting prose is genuinely hard and models are genuinely good at it. The
              compiler uses the Responses API with a strict JSON schema, so the structure of the
              output is enforced at the API boundary rather than parsed hopefully afterwards.
            </p>
            <p>
              The integration is behind a provider-independent interface. Adding Anthropic, a local
              model, or an ensemble means writing one class; the policy engine, the contracts and the
              verifier do not change, because none of them knows a model exists.
            </p>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Ecosystem benefit</h2>
          <Prose>
            <p className="mt-3">
              The parts worth sharing are the boring ones. The Cairo policy library is a set of pure
              functions any Starknet contract can reuse to enforce IntentProof-shaped authorization
              without depending on our registry. The SDK exposes{' '}
              <code>checkPolicy(intent, action)</code> as a pure function so an agent framework can
              adopt the check without adopting the rest.
            </p>
            <p>
              If several agent projects on Starknet committed to intents in a shared format, a user
              could audit agents they did not build, and an agent could check a counterparty&rsquo;s
              authority before trading with it. That is the outcome worth aiming at.
            </p>
          </Prose>
        </section>

        <Callout tone="warn" title="Status">
          Experimental MVP. No independent security audit. No zero-knowledge proof is implemented or
          claimed. Do not use it to protect real funds.
        </Callout>

        <section>
          <SectionLabel>Explore</SectionLabel>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href="/demo" variant="primary">
              Run the demo
            </ButtonLink>
            <ButtonLink href="/docs/security-model">Security model</ButtonLink>
            <ButtonLink href={github} external>
              Source ↗
            </ButtonLink>
          </div>
          <Panel className="mt-6 p-5">
            <p className="text-[13px] leading-relaxed text-text-dim">
              Built by{' '}
              <Link
                href={github}
                className="text-accent underline decoration-accent-dim underline-offset-2"
              >
                pranay123-stack
              </Link>
              . MIT licensed. Contributions, and especially adversarial review of the security model,
              are welcome.
            </p>
          </Panel>
        </section>
      </div>
    </>
  );
}
