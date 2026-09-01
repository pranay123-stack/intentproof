import type { Metadata } from 'next';
import { PageHeader, Panel, Prose, SectionLabel } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Protocol',
  description:
    'The canonical policy encoding, the Poseidon commitment, the receipt format, and how a verifier reproduces a decision.',
};

const CANONICAL_FIELDS = [
  ['canonicalVersion', 'integer', 'Bumping this changes every hash, by design.'],
  ['policyVersion', 'integer', 'The IntentPolicy document version.'],
  ['purpose', 'string', 'Lowercased, whitespace collapsed to underscores.'],
  ['allowedActions', 'string[]', 'Lowercased, deduplicated, sorted.'],
  ['forbiddenActions', 'string[]', 'Lowercased, deduplicated, sorted.'],
  ['allowedAssets', 'string[]', 'Uppercased, deduplicated, sorted.'],
  ['allowedContracts', 'string[]', 'Labels uppercased, addresses lowercased, sorted.'],
  ['allowedDestinations', 'string[]', 'Same normalization. Empty array when absent.'],
  ['maxTransactionValueUsdCents', 'integer | null', 'USD as integer cents; floats have no canonical decimal form.'],
  ['maxDailySpendUsdCents', 'integer | null', 'Same.'],
  ['maxSlippageBps', 'integer | null', 'Basis points.'],
  ['expiresAtUnix', 'integer', 'Seconds since the epoch, so timezone spelling cannot change the hash.'],
  ['explanation', 'string', 'The rationale the human read before approving.'],
];

export default function ProtocolPage() {
  return (
    <>
      <PageHeader
        eyebrow="Docs · protocol"
        title="Canonical form, commitments and receipts"
        lede="The parts that have to agree byte-for-byte between TypeScript and Cairo, written out so a third implementation could match them."
      />

      <div className="mx-auto max-w-4xl px-5 py-12 space-y-12">
        <section>
          <h2 className="text-xl font-semibold tracking-tight">Canonical policy encoding</h2>
          <Prose>
            <p className="mt-3">
              Two policies that grant the same authority must produce the same bytes, whatever order
              their fields arrived in and however their arrays were spelled. The encoding is a JSON
              object written in a fixed field order, prefixed by a domain tag:
            </p>
            <pre className="overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`intentproof/v1/policy
{"canonicalVersion":1,"policyVersion":1,"purpose":"portfolio_management", …}`}
            </pre>
            <p>
              The field order is written out explicitly in the source rather than derived from{' '}
              <code>Object.keys</code> or a sort. The order is part of the protocol, and an explicit
              list is what lets a future v2 add fields without silently reordering v1 commitments.
            </p>
            <p>
              The domain tag matters because three different objects — policies, actions and receipts
              — are hashed with the same primitive. Without a separator, a receipt whose bytes
              happened to coincide with a policy&rsquo;s would produce a colliding commitment.
            </p>
          </Prose>

          <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-panel">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                    Field
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                    Type
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
                    Normalization
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {CANONICAL_FIELDS.map(([field, type, note]) => (
                  <tr key={field}>
                    <td className="px-4 py-2 font-mono text-accent">{field}</td>
                    <td className="px-4 py-2 font-mono text-text-dim">{type}</td>
                    <td className="px-4 py-2 text-text-dim">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Commitment</h2>
          <Prose>
            <p className="mt-3">
              The canonical string is UTF-8 encoded and packed into felts as{' '}
              <code>[byteLength, …31-byte big-endian chunks]</code>, then hashed with Poseidon.
            </p>
            <pre className="overflow-x-auto rounded border border-line bg-panel-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-dim">
{`chunks  = feltChunks(canonical)          // [len, c0, c1, …]
hash    = poseidonHashMany(chunks)       // TypeScript, @scure/starknet
hash    = poseidon_hash_span(chunks)     // Cairo, core::poseidon`}
            </pre>
            <p>
              The length prefix is what makes the encoding injective. Without it{' '}
              <code>&quot;A&quot;</code> and <code>&quot;A\0&quot;</code> pack to the same final chunk,
              and two different policies could share a commitment.
            </p>
            <p>
              Thirty-one bytes per felt, not thirty-two, because the Starknet field is smaller than
              2<sup>252</sup>.
            </p>
            <p className="text-text">
              The two implementations are pinned to each other by shared test vectors: the same three
              inputs are asserted in{' '}
              <code>packages/intent-schema/test/canonical.test.ts</code> and in{' '}
              <code>contracts/tests/test_cross_impl_hash.cairo</code>. A drift in either breaks a
              build.
            </p>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">On-chain recomputation</h2>
          <Prose>
            <p className="mt-3">
              Registration goes through <code>register_intent_from_canonical</code>, which takes the
              chunk array and recomputes the hash inside the contract, reverting on a mismatch. The
              cheaper <code>register_intent</code> exists but takes the caller&rsquo;s word for the
              commitment; paying for the recomputation is what turns &ldquo;we say this policy hashes
              to X&rdquo; into something the network checked.
            </p>
            <p>
              The registry also stores the numeric limits, so <code>record_execution</code> is an
              independent enforcement point rather than a log: it re-checks revocation, expiry,
              replay, the per-transaction cap and the daily budget before writing, using the same
              ordering as the off-chain engine.
            </p>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Execution receipts</h2>
          <Prose>
            <p className="mt-3">
              A receipt is produced for every evaluated action, allowed or rejected, and sealed with
              its own Poseidon commitment over a canonical encoding under the{' '}
              <code>intentproof/v1/receipt</code> domain.
            </p>
            <p>
              Two fields are deliberately excluded from that encoding.{' '}
              <code>receiptHash</code> is the output. <code>transactionHash</code> is excluded
              because the receipt is sealed when the decision is made, and the chain write — if there
              is one — happens afterwards; committing to a field that does not exist yet would make
              the hash unstable exactly when it matters.
            </p>
            <p>
              The full check list is committed, not just the verdict, so &ldquo;the engine said
              ALLOWED&rdquo; and &ldquo;the engine ran these thirteen checks with these
              outcomes&rdquo; cannot drift apart.
            </p>
          </Prose>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">Verification</h2>
          <Prose>
            <p className="mt-3">A verifier holding an intent and a receipt recomputes, in order:</p>
            <ol className="mt-2 space-y-1.5">
              <li>the commitment, from the canonical policy;</li>
              <li>the canonical form itself, from the policy object;</li>
              <li>the action hash, from the recorded action;</li>
              <li>the receipt hash, from everything except itself;</li>
              <li>
                the decision — by re-running the same <code>evaluateAction</code> at the timestamp
                the receipt claims, with the spend ledger rebuilt from prior receipts.
              </li>
            </ol>
            <p className="mt-3">
              A receipt therefore cannot claim ALLOWED for an action the engine rejects, and cannot
              claim a passing check the engine fails: the two would disagree at step five.
            </p>
            <p>
              The verdict has three values, not two. A receipt that passes every local check but that
              no chain has confirmed is <strong>INDETERMINATE</strong>, not verified. Reporting it as
              proven would be the single most misleading thing this system could do.
            </p>
          </Prose>
        </section>

        <section>
          <SectionLabel as="h2">Future work</SectionLabel>
          <Panel className="mt-3 p-5">
            <Prose>
              <p>
                The encoding was chosen so that a proof system could be added without changing what
                anything commits to. Given an intent <code>I</code> and an execution{' '}
                <code>E</code>, the statement worth proving is that <code>E</code> satisfies{' '}
                <code>I</code> — that a sequence of actions passed the policy predicate under a
                committed policy — not that a language model reasoned well.
              </p>
              <p>
                The policy predicate is already a pure function over integers, enums and set
                membership, which is the shape that arithmetizes cleanly. The spend ledger is the
                only stateful part, and it is a fold over prior actions. Nothing about the current
                design forecloses that work, and nothing in it pretends the work is done.
              </p>
            </Prose>
          </Panel>
        </section>
      </div>
    </>
  );
}
