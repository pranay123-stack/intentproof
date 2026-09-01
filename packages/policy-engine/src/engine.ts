import {
  buildReceipt,
  type AgentAction,
  type AuthorizedIntent,
  type ChainAnchor,
  type ExecutionReceipt,
} from '@intentproof/intent-schema';
import { evaluateAction, type EvaluationResult } from './evaluate.js';
import { EMPTY_LEDGER, applyToLedger, type LedgerSnapshot } from './ledger.js';

export interface EngineOptions {
  /** Clock injection point. Tests and replays pass a fixed clock. */
  readonly clock?: () => Date;
  readonly ledger?: LedgerSnapshot;
}

export interface DecisionInput {
  readonly action: AgentAction;
  readonly agentId?: string;
  readonly anchor?: ChainAnchor | null;
}

export interface Decision {
  readonly evaluation: EvaluationResult;
  readonly receipt: ExecutionReceipt;
}

/**
 * Stateful wrapper around `evaluateAction`.
 *
 * The engine owns exactly one piece of state — the ledger of what has already
 * been spent and executed — and exposes it, so a caller can persist it, replay
 * it, or hand it to a verifier. Everything else is recomputed each time.
 *
 * A rejected action never advances the ledger. Rejections are free; that is what
 * makes it safe for an agent to propose speculatively.
 */
export class PolicyEngine {
  readonly #intent: AuthorizedIntent;
  readonly #clock: () => Date;
  #ledger: LedgerSnapshot;

  constructor(intent: AuthorizedIntent, options: EngineOptions = {}) {
    this.#intent = intent;
    this.#clock = options.clock ?? (() => new Date());
    this.#ledger = options.ledger ?? EMPTY_LEDGER;
  }

  get intent(): AuthorizedIntent {
    return this.#intent;
  }

  get ledger(): LedgerSnapshot {
    return this.#ledger;
  }

  /** Evaluate without recording. Pure: calling it twice changes nothing. */
  evaluate(input: DecisionInput): EvaluationResult {
    return evaluateAction({
      intent: this.#intent,
      action: input.action,
      now: this.#clock(),
      ledger: this.#ledger,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    });
  }

  /**
   * Evaluate, record the outcome, and seal a receipt.
   *
   * The receipt is produced for rejections too. A rejected action that leaves no
   * trace is indistinguishable from an action that was never proposed, and the
   * value of this system is being able to show what the agent *tried*.
   */
  decide(input: DecisionInput): Decision {
    const now = this.#clock();
    const evaluation = evaluateAction({
      intent: this.#intent,
      action: input.action,
      now,
      ledger: this.#ledger,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    });

    if (evaluation.allowed) {
      this.#ledger = applyToLedger(this.#ledger, input.action, now);
    }

    const receipt = buildReceipt({
      intentId: this.#intent.intentId,
      intentHash: this.#intent.intentHash,
      agentId: input.agentId ?? this.#intent.agentId,
      action: input.action,
      policyResult: evaluation.allowed ? 'ALLOWED' : 'REJECTED',
      checks: evaluation.checks,
      timestamp: now.toISOString(),
      network: this.#intent.network,
      mode: this.#intent.mode,
      anchor: input.anchor ?? null,
    });

    return { evaluation, receipt };
  }
}
