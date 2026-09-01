'use client';

import type { IntentPolicy } from '@intentproof/intent-schema';
import { describeContractId } from '@intentproof/intent-schema';
import { bps, timestamp, titleCase, usd } from '@/lib/format';
import { Badge } from './ui';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-start gap-x-4 gap-y-1 border-b border-line/60 px-4 py-2.5 last:border-b-0">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">{label}</p>
      <div className="min-w-0 text-[13px] text-text">{children}</div>
    </div>
  );
}

/**
 * The review screen.
 *
 * Written for someone deciding whether to grant authority, so it leads with what
 * is permitted and what is refused rather than with the JSON. The refusals get
 * equal visual weight: "you may swap" and "you may never borrow" are two
 * different promises and a reader has to be able to check both.
 */
export function PolicyView({ policy }: { policy: IntentPolicy }) {
  return (
    <dl className="divide-y divide-line/60">
      <Row label="Purpose">{titleCase(policy.purpose)}</Row>

      <Row label="Allowed actions">
        <div className="flex flex-wrap gap-1.5">
          {policy.allowedActions.map((action) => (
            <Badge key={action} tone="allow">
              ✓ {action.replace(/_/gu, ' ')}
            </Badge>
          ))}
        </div>
      </Row>

      <Row label="Forbidden">
        {policy.forbiddenActions.length === 0 ? (
          <span className="text-text-dim">Nothing was explicitly forbidden.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {policy.forbiddenActions.map((action) => (
              <Badge key={action} tone="reject">
                ✗ {action.replace(/_/gu, ' ')}
              </Badge>
            ))}
          </div>
        )}
      </Row>

      <Row label="Allowed assets">
        <div className="flex flex-wrap gap-1.5">
          {policy.allowedAssets.map((asset) => (
            <span
              key={asset}
              className="rounded border border-line-strong bg-panel-2 px-2 py-0.5 font-mono text-[11.5px]"
            >
              {asset}
            </span>
          ))}
        </div>
      </Row>

      <Row label="Allowed protocols">
        <ul className="space-y-1">
          {policy.allowedContracts.map((id) => (
            <li key={id} className="flex flex-wrap items-baseline gap-2">
              <span>{describeContractId(id)}</span>
              <span className="font-mono text-[11px] text-text-faint">{id}</span>
            </li>
          ))}
        </ul>
      </Row>

      <Row label="Allowed destinations">
        {(policy.allowedDestinations ?? []).length === 0 ? (
          <span className="text-text-dim">
            None. Outbound transfers are refused — an empty destination list means nowhere, not
            anywhere.
          </span>
        ) : (
          <ul className="space-y-1">
            {policy.allowedDestinations?.map((id) => (
              <li key={id} className="font-mono text-[12px]">
                {id}
              </li>
            ))}
          </ul>
        )}
      </Row>

      <Row label="Max transaction">{usd(policy.maxTransactionValueUsd)}</Row>
      <Row label="Max daily spend">{usd(policy.maxDailySpendUsd)}</Row>
      <Row label="Max slippage">{bps(policy.maxSlippageBps)}</Row>
      <Row label="Expires">{timestamp(policy.expiresAt)}</Row>

      {policy.metadata?.explanation ? (
        <Row label="Explanation">
          <p className="leading-relaxed text-text-dim">{policy.metadata.explanation}</p>
        </Row>
      ) : null}
    </dl>
  );
}
