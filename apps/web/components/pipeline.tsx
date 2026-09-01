import type { ReactNode } from 'react';

export interface PipelineNode {
  readonly label: string;
  readonly note?: string;
  readonly tone?: 'default' | 'human' | 'model' | 'engine' | 'chain';
}

const TONE: Record<NonNullable<PipelineNode['tone']>, string> = {
  default: 'border-line-strong bg-panel-2 text-text',
  human: 'border-accent-dim bg-accent-dim/25 text-accent',
  model: 'border-warn/40 bg-warn-dim/40 text-warn',
  engine: 'border-allow/40 bg-allow-dim/50 text-allow',
  chain: 'border-line-strong bg-panel-2 text-text',
};

/**
 * The pipeline, drawn once and reused.
 *
 * Colour carries the trust boundary rather than decoration: the model step is
 * amber because it is the untrusted one, the engine step is green because it is
 * the authority, and the human steps are accent because they are where control
 * actually sits.
 */
export function Pipeline({
  nodes,
  caption,
}: {
  nodes: readonly PipelineNode[];
  caption?: ReactNode;
}) {
  return (
    <figure className="rounded-lg border border-line bg-panel p-4 sm:p-6">
      <ol className="flex flex-col items-center gap-0">
        {nodes.map((node, index) => (
          <li key={node.label} className="flex w-full max-w-sm flex-col items-center">
            <div
              className={`w-full rounded border px-3 py-2 text-center ${TONE[node.tone ?? 'default']}`}
            >
              <p className="font-mono text-[12px] tracking-tight">{node.label}</p>
              {node.note ? (
                <p className="mt-0.5 text-[11px] leading-snug opacity-70">{node.note}</p>
              ) : null}
            </div>
            {index < nodes.length - 1 ? (
              <span aria-hidden className="my-1 font-mono text-[13px] text-text-faint">
                ↓
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {caption ? (
        <figcaption className="mt-5 text-center text-[12.5px] leading-relaxed text-text-dim">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export const CORE_PIPELINE: readonly PipelineNode[] = [
  { label: 'Human intent', note: 'plain language', tone: 'human' },
  { label: 'OpenAI', note: 'interprets — cannot authorize', tone: 'model' },
  { label: 'Structured policy', note: 'schema + semantic gates' },
  { label: 'Human approval', note: 'explicit, required', tone: 'human' },
  { label: 'Intent commitment', note: 'Poseidon hash of the canonical policy' },
  { label: 'Starknet', note: 'IntentRegistry', tone: 'chain' },
  { label: 'AI agent', note: 'proposes actions', tone: 'model' },
  { label: 'Policy engine', note: 'deterministic — decides', tone: 'engine' },
  { label: 'Execution receipt', note: 'sealed for allow and reject alike' },
  { label: 'Verification', note: 'anyone can recompute' },
];
