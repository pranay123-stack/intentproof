import type { Metadata } from 'next';
import Link from 'next/link';
import { CHECK_ORDER } from '@intentproof/sdk';
import { PageHeader, Panel, Prose, SectionLabel } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'How to run IntentProof, how to integrate the SDK, and what it does and does not prove.',
};

const CHECK_NOTES: Record<string, string> = {
  intent_hash_integrity: 'The policy still hashes to the commitment that was registered.',
  agent_authorized: 'The acting agent is the one the intent names.',
  intent_not_revoked: 'The user has not revoked this authorization.',
  intent_not_expired: 'The authorization has not lapsed.',
  action_allowed: 'The action kind appears in the allowed list.',
  action_not_forbidden: 'The action kind does not appear in the forbidden list.',
  asset_allowed: 'Every asset the action touches is authorized.',
  contract_allowed: 'The target protocol is on the allowlist.',
  destination_allowed: 'Any recipient of outbound value is on the allowlist.',
  transaction_limit: 'The action is within the per-transaction cap.',
  slippage_limit: 'Requested slippage is within the authorized bound.',
  daily_limit: 'The action fits inside the remaining daily budget.',
  replay_protection: 'This action has not already been executed under this intent.',
};

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="Running and integrating IntentProof"
        lede="Everything here works without a blockchain and without an OpenAI key; both are upgrades rather than requirements."
      />

      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
          <div className="space-y-12">
            <section>
              <h2 className="text-xl font-semibold tracking-tight">Local development</h2>
              <Prose>
                <p className="mt-3">
                  Node 22 or newer, and pnpm. Clone the repository and run:
                </p>
                <pre className="overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`pnpm install
pnpm build:packages   # workspace packages compile to dist/
pnpm dev              # http://localhost:3000`}
                </pre>
                <p>
                  With no <code>.env.local</code> at all the app runs in LOCAL DEMO MODE and a
                  rule-based parser drafts policies. Commitments, enforcement, receipts and
                  verification are fully functional; only the chain write and the language model are
                  absent, and the interface says so on every screen.
                </p>
              </Prose>
            </section>

            <section>
              <h2 className="text-xl font-semibold tracking-tight">OpenAI setup</h2>
              <Prose>
                <p className="mt-3">
                  Put a key in <code>.env.local</code>:
                </p>
                <pre className="overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6`}
                </pre>
                <p>
                  The key is read only in server-side route handlers. It never appears in a{' '}
                  <code>NEXT_PUBLIC_*</code> variable and never reaches the browser. Requests are
                  sent with <code>store: false</code>, and neither the prompt nor the model output is
                  written to a log or echoed into an error body.
                </p>
                <p>
                  The compiler uses the Responses API with a strict JSON schema derived from the Zod
                  proposal schema, so structural violations fail at the API boundary rather than in
                  our parser. Optional fields are expressed as nullable rather than omitted: a model
                  that leaves out a spending limit is a model that has said nothing about it, and
                  silence is not something we want to interpret.
                </p>
                <p>
                  Set <code>INTENTPROOF_ALLOW_FALLBACK_COMPILER=false</code> to make a missing key a
                  hard error instead of falling back to the rule-based parser.
                </p>
              </Prose>
            </section>

            <section>
              <h2 className="text-xl font-semibold tracking-tight">Starknet setup</h2>
              <Prose>
                <p className="mt-3">
                  Deploy the contracts, then point the app at the registry:
                </p>
                <pre className="overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`STARKNET_RPC_URL=https://starknet-sepolia.drpc.org
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
INTENT_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_STARKNET_NETWORK=sepolia`}
                </pre>
                <p>
                  A registry address alone is enough for read-only mode: existing intents can be read
                  and verified against the chain without a signing key. Adding the key enables
                  registration, revocation and execution recording.
                </p>
                <p>
                  Deployment is <code>pnpm deploy:sepolia</code>, which declares both classes, deploys
                  them, and writes the addresses to <code>deployments/</code>. It refuses to run
                  without a funded account rather than half-completing.
                </p>
              </Prose>
            </section>

            <section>
              <h2 className="text-xl font-semibold tracking-tight">SDK</h2>
              <Prose>
                <p className="mt-3">
                  One dependency, and the safe path is the short one:
                </p>
                <pre className="overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`import { IntentProof } from '@intentproof/sdk';

const compiled = await IntentProof.compileIntent({
  naturalLanguage: \`
    Manage my portfolio.
    Swap ETH and STRK.
    Never use leverage.
    Maximum $500 per transaction.
  \`,
});

// Show compiled.policy to the user. Only then:
const { intent } = await IntentProof.authorize({ policy: compiled.policy });

const result = IntentProof.checkAction(intent, action);
if (!result.allowed) {
  throw new Error(\`Intent violation: \${result.reasons.join('; ')}\`);
}`}
                </pre>
                <p>
                  For an agent loop that wants nothing else from this project,{' '}
                  <code>IntentProof.checkPolicy(intent, action)</code> is a pure function: no client,
                  no environment, no I/O, same verdict on any machine.
                </p>
                <p>
                  There is no method that evaluates an action against anything but the deterministic
                  engine, and no way to ask a model whether something is permitted. That absence is
                  the API design.
                </p>
              </Prose>
            </section>

            <section>
              <h2 className="text-xl font-semibold tracking-tight">The check list</h2>
              <Prose>
                <p className="mt-3">
                  Every evaluation runs all thirteen, in this order, and commits the outcomes into
                  the receipt. Checks do not short-circuit: an action that is wrong in four ways says
                  so, because a receipt that named only the first reason would hide the rest.
                </p>
              </Prose>
              <ol className="mt-4 divide-y divide-line/60 rounded-lg border border-line bg-panel">
                {CHECK_ORDER.map((name, index) => (
                  <li key={name} className="flex gap-4 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-text-faint">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="font-mono text-[12.5px] text-text">{name}</p>
                      <p className="mt-0.5 text-[12.5px] text-text-dim">{CHECK_NOTES[name]}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-semibold tracking-tight">Testing</h2>
              <Prose>
                <pre className="mt-3 overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`pnpm test          # TypeScript: schema, engine, compiler, SDK, agent
pnpm test:cairo    # snforge: contracts, policy library, cross-impl hashes
pnpm verify        # lint + typecheck + both suites + production build`}
                </pre>
                <p>
                  No test makes a network request. The OpenAI compiler is exercised through an
                  injected client stub, which is what lets the suite cover refusals, truncated
                  responses and malformed proposals — cases a live model would produce only by
                  accident.
                </p>
              </Prose>
            </section>

            <section>
              <h2 className="text-xl font-semibold tracking-tight">Current limitations</h2>
              <Prose>
                <ul className="mt-3 space-y-2">
                  <li>No independent security audit. Treat this as a prototype.</li>
                  <li>
                    No zero-knowledge proof. What exists is a verifiable execution receipt:
                    commitment plus deterministic re-derivation.
                  </li>
                  <li>
                    The agent simulates rather than trades. Nothing signs a swap; the engine sits
                    where a real integration would put it, in front of the signer.
                  </li>
                  <li>
                    The protocol directory ships labels, not addresses. Publishing invented addresses
                    for real venues would be a fabricated allowlist that looks authoritative.
                  </li>
                  <li>
                    Intents are stored in a JSON file, or in memory on a read-only host. Verification
                    never depends on that store — every check is a recomputation.
                  </li>
                  <li>
                    Prices are supplied as USD notionals by the caller. A production deployment needs
                    an oracle, and the oracle then becomes part of the trust model.
                  </li>
                </ul>
              </Prose>
            </section>
          </div>

          <aside className="space-y-3">
            <SectionLabel>Sections</SectionLabel>
            <Panel className="p-4">
              <ul className="space-y-2 text-[13px]">
                {[
                  ['/docs/protocol', 'Protocol specification'],
                  ['/docs/security-model', 'Security model'],
                  ['/architecture', 'Architecture'],
                  ['/roadmap', 'Roadmap'],
                ].map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href!}
                      className="text-accent underline decoration-accent-dim underline-offset-2"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
        </div>
      </div>
    </>
  );
}
