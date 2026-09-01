import type { Metadata } from 'next';
import { Badge, PageHeader, Panel, Prose } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What exists today, and what each subsequent phase would have to solve.',
};

const PHASES = [
  {
    phase: 'Phase 1',
    title: 'MVP',
    status: 'Built' as const,
    tone: 'allow' as const,
    body: 'Natural language to a structured policy, schema and semantic gates, human approval, a Poseidon commitment recomputed on chain, deterministic enforcement, sealed receipts, and independent verification. Cairo contracts with 59 tests; TypeScript packages with 137.',
    items: [
      'IntentRegistry and ExecutionVerifier on Cairo 2.20',
      'Thirteen-check deterministic policy engine, no model in the loop',
      'Cross-implementation Poseidon vectors pinned in both test suites',
      'Local demo mode that never fabricates a transaction',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Cryptographic proof generation',
    status: 'Designed, not built' as const,
    tone: 'warn' as const,
    body: 'Prove that an execution satisfies an intent without replaying the whole history. The policy predicate is already a pure function over integers, enums and set membership; the spend ledger is a fold. That is the shape that arithmetizes.',
    items: [
      'Circuit for the policy predicate over a committed policy',
      'Recursive aggregation so a day of activity verifies as one proof',
      'On-chain verification through Starknet’s existing proof infrastructure',
      'Honest scoping: prove the constraints, not that a model is intelligent',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'Composable intents',
    status: 'Research' as const,
    tone: 'neutral' as const,
    body: 'An agent that delegates to a second agent should not be able to delegate authority it does not hold. Sub-intents would be derived from a parent commitment, with the child’s policy provably a subset of the parent’s.',
    items: [
      'Sub-intent derivation with a subset proof',
      'Delegation depth limits and revocation that cascades',
      'Shared spend budgets across a delegation tree',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Cross-agent authorization',
    status: 'Research' as const,
    tone: 'neutral' as const,
    body: 'Agents transacting with each other need to check counterparty authority the way they check a signature today. The registry is the natural place for that lookup, and the SDK is the natural place for the check.',
    items: [
      'Counterparty intent lookup as a precondition to trade',
      'Reputation derived from verified receipts rather than self-report',
      'A standard other Starknet agent frameworks can adopt',
    ],
  },
];

export default function RoadmapPage() {
  return (
    <>
      <PageHeader
        eyebrow="Roadmap"
        title="Where this goes, and what is honestly still unsolved"
        lede="Phase 1 is running. The later phases are written as problems to solve rather than features to ship, because that is what they currently are."
      />

      <div className="mx-auto max-w-4xl px-5 py-12">
        <div className="space-y-5">
          {PHASES.map((phase) => (
            <Panel key={phase.phase} className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-faint">
                  {phase.phase}
                </span>
                <h2 className="text-lg font-semibold tracking-tight">{phase.title}</h2>
                <Badge tone={phase.tone}>{phase.status}</Badge>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-text-dim">{phase.body}</p>
              <ul className="mt-3 space-y-1.5">
                {phase.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[13px] text-text-dim">
                    <span aria-hidden className="text-text-faint">
                      ·
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight">On the proof phase specifically</h2>
          <Prose>
            <p className="mt-3">
              It would be easy to describe Phase 1 as a proof system and collect the credibility that
              comes with the word. That would be a lie, and it would also be the wrong ambition:
              proving that a language model reasoned correctly is neither tractable nor useful.
            </p>
            <p>
              The tractable statement is narrower. Given a committed intent <code>I</code> and an
              execution trace <code>E</code>, prove that every action in <code>E</code> satisfied the
              policy predicate of <code>I</code> — without the verifier needing the trace, and without
              anyone trusting the party that produced it. That is a statement about arithmetic over a
              committed structure, which is exactly what Starknet&rsquo;s proving infrastructure is
              for.
            </p>
            <p className="text-text">
              Until that exists, this project says &ldquo;verifiable execution receipt&rdquo; and
              means it literally.
            </p>
          </Prose>
        </section>
      </div>
    </>
  );
}
