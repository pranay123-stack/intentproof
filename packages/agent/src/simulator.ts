import type { AgentAction, AuthorizedIntent } from '@intentproof/intent-schema';
import { createRng } from './random.js';
import type { AgentStrategy } from './strategy.js';

export interface AgentSimulatorOptions {
  readonly agentId?: string;
  readonly seed?: number;
  readonly clock?: () => Date;
}

/**
 * Produces proposed actions. Nothing else.
 *
 * The simulator has no reference to the policy engine, no way to ask whether an
 * action would be allowed, and no way to see a verdict. That separation is not a
 * stylistic choice — an agent that could inspect the engine could shape its
 * proposals to pass, and the demo would prove nothing.
 */
export class AgentSimulator {
  readonly agentId: string;
  readonly strategy: AgentStrategy;
  readonly #rng: () => number;
  readonly #clock: () => Date;
  #step = 0;

  constructor(strategy: AgentStrategy, options: AgentSimulatorOptions = {}) {
    this.strategy = strategy;
    this.agentId = options.agentId ?? `agent_${strategy.id}`;
    this.#rng = createRng(options.seed ?? 0x1e7e7);
    this.#clock = options.clock ?? (() => new Date());
  }

  get step(): number {
    return this.#step;
  }

  next(intent: AuthorizedIntent): AgentAction | null {
    const action = this.strategy.propose({
      intent,
      now: this.#clock(),
      rng: this.#rng,
      step: this.#step,
    });
    if (action) this.#step += 1;
    return action;
  }

  /** Drain up to `count` proposals. Stops early if the strategy is done. */
  plan(intent: AuthorizedIntent, count: number): AgentAction[] {
    const actions: AgentAction[] = [];
    for (let i = 0; i < count; i += 1) {
      const action = this.next(intent);
      if (!action) break;
      actions.push(action);
    }
    return actions;
  }
}
