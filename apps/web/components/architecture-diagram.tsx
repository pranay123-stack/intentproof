const BOX =
  'rounded border px-3 py-2 text-center font-mono text-[11.5px] leading-tight tracking-tight';

function Node({
  label,
  note,
  tone = 'default',
}: {
  label: string;
  note?: string;
  tone?: 'default' | 'human' | 'untrusted' | 'authority' | 'chain';
}) {
  const tones = {
    default: 'border-line-strong bg-panel-2 text-text',
    human: 'border-accent-dim bg-accent-dim/25 text-accent',
    untrusted: 'border-warn/45 bg-warn-dim/40 text-warn',
    authority: 'border-allow/45 bg-allow-dim/50 text-allow',
    chain: 'border-line-strong bg-panel-2 text-text',
  };
  return (
    <div className={`${BOX} ${tones[tone]}`}>
      <div>{label}</div>
      {note ? <div className="mt-0.5 text-[10.5px] opacity-70">{note}</div> : null}
    </div>
  );
}

const Arrow = () => (
  <span aria-hidden className="my-1 block text-center font-mono text-[13px] text-text-faint">
    ↓
  </span>
);

/**
 * The architecture, with the trust boundary drawn rather than described.
 *
 * The dashed frame is the load-bearing element: everything inside it is
 * untrusted, and the diagram is arranged so that no arrow crosses out of it
 * except into a gate.
 */
export function ArchitectureDiagram() {
  return (
    <figure className="overflow-x-auto rounded-lg border border-line bg-panel p-5 sm:p-8">
      <div className="mx-auto min-w-[20rem] max-w-md">
        <Node label="USER" note="writes a mandate in plain language" tone="human" />
        <Arrow />

        <div className="rounded-lg border border-dashed border-warn/40 bg-warn-dim/10 p-3">
          <p className="mb-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-warn">
            Untrusted zone
          </p>
          <Node label="OpenAI" note="interprets — never authorizes" tone="untrusted" />
          <Arrow />
          <Node label="Structured intent proposal" note="strict JSON schema" tone="untrusted" />
        </div>

        <Arrow />
        <Node label="Schema validation" note="closed enums · no unknown fields" />
        <Arrow />
        <Node label="Semantic validation" note="no unbounded grants · known protocols only" />
        <Arrow />
        <Node label="HUMAN APPROVAL" note="explicit, required, revocable" tone="human" />
        <Arrow />
        <Node label="Canonical policy" note="deterministic byte encoding" />
        <Arrow />
        <Node label="Intent hash" note="Poseidon over 31-byte chunks" />
        <Arrow />
        <Node label="STARKNET" note="IntentRegistry recomputes the hash on chain" tone="chain" />
        <Arrow />

        <div className="rounded-lg border border-dashed border-warn/40 bg-warn-dim/10 p-3">
          <p className="mb-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-warn">
            Untrusted zone
          </p>
          <Node label="AI AGENT" note="proposes actions, sees no verdicts" tone="untrusted" />
        </div>

        <Arrow />
        <Node label="POLICY ENGINE" note="deterministic · 13 checks · no model" tone="authority" />

        <div aria-hidden className="my-1 grid grid-cols-2 text-center font-mono text-[13px] text-text-faint">
          <span>↓</span>
          <span>↓</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={`${BOX} border-allow/45 bg-allow-dim/50 text-allow`}>ALLOW</div>
            <Arrow />
            <div className={`${BOX} border-line-strong bg-panel-2 text-text`}>Execution</div>
          </div>
          <div>
            <div className={`${BOX} border-reject/45 bg-reject-dim/50 text-reject`}>REJECT</div>
            <Arrow />
            <div className={`${BOX} border-line-strong bg-panel-2 text-text`}>Blocked</div>
          </div>
        </div>

        <div aria-hidden className="my-1 text-center font-mono text-[13px] text-text-faint">
          ↓ both paths ↓
        </div>
        <Node label="Receipt generator" note="sealed at decision time" />
        <Arrow />
        <Node label="VERIFIER" note="recomputes everything from the receipt" tone="authority" />
      </div>

      <figcaption className="mx-auto mt-6 max-w-md text-[12.5px] leading-relaxed text-text-dim">
        Nothing leaves an untrusted zone without passing a gate. The model's output passes schema
        and semantic validation and then a human; the agent's output passes the policy engine. Both
        gates are ordinary deterministic code with no model in the loop.
      </figcaption>
    </figure>
  );
}
