'use client';

import {
  ACTION_KINDS,
  PROTOCOL_DIRECTORY,
  computeIntentHash,
  type ActionKind,
  type IntentPolicy,
} from '@intentproof/intent-schema';
import { useMemo } from 'react';
import { shortHash } from '@/lib/format';

const KNOWN_ASSETS = ['ETH', 'STRK', 'USDC', 'USDT', 'WBTC', 'DAI'] as const;

function Chip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: 'allow' | 'reject' | 'accent';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeClass = {
    allow: 'border-allow/50 bg-allow-dim/60 text-allow',
    reject: 'border-reject/50 bg-reject-dim/60 text-reject',
    accent: 'border-accent-dim bg-accent-dim/30 text-accent',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
        active ? activeClass : 'border-line-strong bg-panel-2 text-text-faint hover:text-text-dim'
      }`}
    >
      {children}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
}) {
  const id = `field-${label.replace(/\s+/gu, '-').toLowerCase()}`;
  return (
    <label htmlFor={id} className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </span>
      <span className="mt-1.5 flex items-center gap-1 rounded border border-line-strong bg-panel-2 px-2 focus-within:border-accent-dim">
        {prefix ? <span className="font-mono text-[12px] text-text-faint">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          min={0}
          step={step}
          value={value ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
          className="w-full bg-transparent py-1.5 font-mono text-[13px] text-text outline-none"
        />
        {suffix ? <span className="font-mono text-[12px] text-text-faint">{suffix}</span> : null}
      </span>
    </label>
  );
}

/**
 * Editing the interpretation before authorizing it.
 *
 * The commitment is recomputed on every keystroke and shown alongside the
 * controls. That is the point of the screen: a user who changes one number
 * should watch the hash change, because the hash is what makes an edit
 * detectable later. Nothing is committed until they approve.
 */
export function PolicyEditor({
  policy,
  onChange,
}: {
  policy: IntentPolicy;
  onChange: (next: IntentPolicy) => void;
}) {
  const hash = useMemo(() => {
    try {
      return computeIntentHash(policy);
    } catch {
      return null;
    }
  }, [policy]);

  const toggle = (list: readonly string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="space-y-5 px-4 py-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
          Allowed actions
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ACTION_KINDS.map((kind) => (
            <Chip
              key={kind}
              tone="allow"
              active={policy.allowedActions.includes(kind)}
              onClick={() =>
                onChange({
                  ...policy,
                  allowedActions: toggle(policy.allowedActions, kind) as ActionKind[],
                })
              }
            >
              {kind}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
          Forbidden actions
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ACTION_KINDS.map((kind) => (
            <Chip
              key={kind}
              tone="reject"
              active={policy.forbiddenActions.includes(kind)}
              onClick={() =>
                onChange({
                  ...policy,
                  forbiddenActions: toggle(policy.forbiddenActions, kind) as ActionKind[],
                })
              }
            >
              {kind}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
          Allowed assets
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KNOWN_ASSETS.map((asset) => (
            <Chip
              key={asset}
              tone="accent"
              active={policy.allowedAssets.includes(asset)}
              onClick={() => onChange({ ...policy, allowedAssets: toggle(policy.allowedAssets, asset) })}
            >
              {asset}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
          Allowed protocols
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROTOCOL_DIRECTORY.map((entry) => (
            <Chip
              key={entry.id}
              tone="accent"
              active={policy.allowedContracts.includes(entry.id)}
              onClick={() =>
                onChange({ ...policy, allowedContracts: toggle(policy.allowedContracts, entry.id) })
              }
            >
              {entry.id}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Max transaction"
          prefix="$"
          value={policy.maxTransactionValueUsd}
          onChange={(next) => onChange({ ...policy, maxTransactionValueUsd: next })}
        />
        <NumberField
          label="Max daily"
          prefix="$"
          value={policy.maxDailySpendUsd}
          onChange={(next) => onChange({ ...policy, maxDailySpendUsd: next })}
        />
        <NumberField
          label="Max slippage"
          suffix="bps"
          step={5}
          value={policy.maxSlippageBps}
          onChange={(next) => onChange({ ...policy, maxSlippageBps: next })}
        />
      </div>

      <div className="rounded border border-line bg-panel-2 px-3 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
          Commitment for this draft
        </p>
        <p className="mt-1 hash text-accent" aria-live="polite">
          {hash ? shortHash(hash, 26, 12) : 'invalid policy'}
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-text-dim">
          Every edit above changes this hash. That is what makes a later change to the policy
          detectable — the commitment stops matching.
        </p>
      </div>
    </div>
  );
}
