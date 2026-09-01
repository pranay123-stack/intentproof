import type { IntentProposal } from '@intentproof/intent-schema';
import { finalizeProposal } from './normalize.js';
import { assertUsableInput } from './prompt.js';
import {
  CompilationError,
  type CompileOptions,
  type CompileResult,
  type IntentCompiler,
} from './types.js';

/**
 * A compiler that returns a proposal you hand it.
 *
 * Used by the test suite so that the pipeline downstream of the model —
 * normalization, schema gate, semantic gate, commitment — can be exercised
 * without a network call, and so that a deliberately malformed proposal can be
 * pushed through the gates to prove they hold.
 */
export class StaticIntentCompiler implements IntentCompiler {
  readonly id: string;
  readonly kind = 'deterministic' as const;
  readonly model = null;
  readonly #proposal: IntentProposal | (() => IntentProposal);

  constructor(proposal: IntentProposal | (() => IntentProposal), id = 'static-intent-compiler') {
    this.#proposal = proposal;
    this.id = id;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async compile(input: string, options: CompileOptions = {}): Promise<CompileResult> {
    try {
      assertUsableInput(input);
    } catch (error) {
      throw new CompilationError('input', (error as Error).message);
    }
    const now = options.now ?? new Date();
    const proposal = typeof this.#proposal === 'function' ? this.#proposal() : this.#proposal;
    const { policy, warnings } = finalizeProposal(proposal, now);
    return {
      policy,
      proposal,
      warnings,
      provenance: {
        compilerId: this.id,
        kind: this.kind,
        model: null,
        createdAt: now.toISOString(),
        durationMs: 0,
        isModelGenerated: false,
      },
    };
  }
}
