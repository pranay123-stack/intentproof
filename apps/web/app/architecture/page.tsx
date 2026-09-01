import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureDiagram } from '@/components/architecture-diagram';
import { Callout, PageHeader, Panel, Prose, SectionLabel } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'Where the trust boundary sits: the LLM proposes, a deterministic policy engine enforces, and Starknet holds the commitment.',
};

const LAYERS = [
  {
    name: 'packages/intent-schema',
    role: 'Schema, canonicalization, Poseidon commitments',
    note: 'Zero runtime dependencies beyond zod and @scure/starknet. Runs in a browser, a server, or a script.',
  },
  {
    name: 'packages/intent-compiler',
    role: 'Natural language → structured proposal',
    note: 'Provider-independent interface. OpenAI today; adding another model means one new class.',
  },
  {
    name: 'packages/policy-engine',
    role: 'The authority',
    note: 'Thirteen deterministic checks, a spend ledger, and a replay function the verifier reuses.',
  },
  {
    name: 'packages/starknet',
    role: 'Chain client',
    note: 'Two implementations behind one type: a real registry client and a local one that returns null anchors.',
  },
  {
    name: 'packages/agent',
    role: 'Agent simulator',
    note: 'Imports the schema and nothing else. It cannot reach the policy engine, by construction.',
  },
  {
    name: 'contracts/',
    role: 'Cairo',
    note: 'IntentRegistry, ExecutionVerifier, a reusable policy library and an ownable component.',
  },
];

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        eyebrow="Architecture"
        title="The LLM is not the enforcement mechanism"
        lede="Every design decision in IntentProof follows from one line: a language model may interpret and plan, but it may not decide what it is authorized to do."
      />

      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <ArchitectureDiagram />

          <div className="space-y-8">
            <section>
              <SectionLabel>The critical trust boundary</SectionLabel>
              <Prose>
                <p className="mt-3">
                  The failure mode this system exists to prevent is subtle. It is not that a model
                  will obviously misbehave — it is that a model asked to both interpret an
                  instruction and check its own compliance will make the same mistake twice and
                  report success. Prompt injection makes this worse: the attacker controls the input
                  to both roles at once.
                </p>
                <p>
                  So the roles are split. The model produces a <em>proposal</em>, which is a data
                  structure, not a decision. That proposal has to survive a schema whose action
                  kinds are a closed enum and whose protocol identifiers come from a directory; then
                  a semantic gate that refuses unbounded grants; then a human being who reads it.
                </p>
                <p className="text-text">
                  After approval the model is out of the loop entirely. Enforcement is a pure
                  function of the policy, the action, the clock and the spend ledger. It has no
                  network access, no model call and no configuration.
                </p>
              </Prose>
            </section>

            <section>
              <SectionLabel>What Starknet contributes</SectionLabel>
              <Prose>
                <p className="mt-3">
                  A commitment stored only by the party being audited is not a commitment. Starknet
                  gives the policy a home neither the user, the agent nor this application can
                  silently rewrite.
                </p>
                <p>
                  It also gives it a second enforcement point. The registry does not merely record a
                  hash: registration goes through{' '}
                  <code>register_intent_from_canonical</code>, which hands the contract the canonical
                  chunks and makes <em>it</em> recompute the Poseidon commitment. Cairo&rsquo;s native{' '}
                  <code>poseidon_hash_span</code> produces the same felt as the TypeScript
                  canonicalizer — a fact asserted by vectors in both test suites, so a drift in
                  either implementation breaks a build.
                </p>
                <p>
                  The numeric limits are mirrored on chain too, so <code>record_execution</code> re-checks
                  expiry, revocation, replay, the per-transaction cap and the daily budget before it
                  writes. An agent that bypassed the off-chain engine still cannot get an
                  over-limit action into the record.
                </p>
              </Prose>
            </section>

            <Callout tone="warn" title="Where the guarantees stop">
              IntentProof cannot tell you the model understood you correctly — only that whatever a
              human approved is exactly what got enforced, and that the record of what happened is
              one anybody can recompute. It also does not execute trades; the MVP evaluates and
              records, and a production integration would place the engine in front of a real
              signer.
            </Callout>
          </div>
        </div>

        <section className="mt-14">
          <SectionLabel>Repository layout</SectionLabel>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LAYERS.map((layer) => (
              <Panel key={layer.name} className="p-4">
                <p className="font-mono text-[12px] text-accent">{layer.name}</p>
                <p className="mt-1.5 text-[13px] font-medium text-text">{layer.role}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">{layer.note}</p>
              </Panel>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <SectionLabel>Read next</SectionLabel>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
            <Link className="text-accent underline decoration-accent-dim underline-offset-2" href="/docs/protocol">
              Protocol: canonical form, hashing, receipts →
            </Link>
            <Link className="text-accent underline decoration-accent-dim underline-offset-2" href="/docs/security-model">
              Security model: what each attack runs into →
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
