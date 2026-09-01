import type { AgentAction } from '@intentproof/intent-schema';

export const SECONDS_PER_DAY = 86_400;

/** UTC day bucket, matching `policy::day_index` in Cairo exactly. */
export function dayIndex(at: Date): number {
  return Math.floor(at.getTime() / 1000 / SECONDS_PER_DAY);
}

/**
 * What the engine needs to know about the past.
 *
 * Kept as plain data rather than hidden inside the engine so that `evaluate` is
 * a pure function of (intent, action, now, ledger). That is what makes an
 * evaluation reproducible by a third party holding only the receipt and the
 * prior receipts — which is the whole point of the verification page.
 */
export interface LedgerSnapshot {
  /** day index -> USD already committed that day */
  readonly spentUsdByDay: Readonly<Record<number, number>>;
  /** Action ids already executed under this intent. */
  readonly executedActionIds: readonly string[];
}

export const EMPTY_LEDGER: LedgerSnapshot = Object.freeze({
  spentUsdByDay: Object.freeze({}),
  executedActionIds: Object.freeze([]),
});

export function spentOnDay(ledger: LedgerSnapshot, at: Date): number {
  return ledger.spentUsdByDay[dayIndex(at)] ?? 0;
}

/** Fold an allowed action into the ledger. Rejected actions never spend budget. */
export function applyToLedger(
  ledger: LedgerSnapshot,
  action: AgentAction,
  at: Date,
): LedgerSnapshot {
  const day = dayIndex(at);
  return {
    spentUsdByDay: {
      ...ledger.spentUsdByDay,
      [day]: (ledger.spentUsdByDay[day] ?? 0) + action.valueUsd,
    },
    executedActionIds: [...ledger.executedActionIds, action.id],
  };
}

/** Rebuild the ledger from a receipt history — the verifier's entry point. */
export function ledgerFromHistory(
  history: readonly { action: AgentAction; timestamp: string; policyResult: string }[],
): LedgerSnapshot {
  let ledger = EMPTY_LEDGER;
  for (const entry of history) {
    if (entry.policyResult !== 'ALLOWED') continue;
    ledger = applyToLedger(ledger, entry.action, new Date(entry.timestamp));
  }
  return ledger;
}
