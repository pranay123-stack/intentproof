import { DeterministicIntentCompiler } from './deterministic.js';
import { OpenAIIntentCompiler } from './openai.js';
import type { IntentCompiler } from './types.js';

/** Shaped to accept `process.env` directly as well as a hand-built object. */
export interface CompilerEnvironment {
  readonly [key: string]: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
  readonly OPENAI_MODEL?: string | undefined;
  readonly INTENTPROOF_ALLOW_FALLBACK_COMPILER?: string | undefined;
}

export interface CompilerSelection {
  readonly compiler: IntentCompiler;
  /** Why this compiler was chosen — rendered in the UI, not just logged. */
  readonly reason: string;
}

/**
 * Pick a compiler from the environment.
 *
 * An OpenAI key selects the model. Without one, the rule-based compiler is used
 * only if the operator opted in; otherwise the caller gets an error rather than
 * a quiet substitution. Falling back silently would let a deployment claim AI
 * interpretation it is not performing.
 */
export function selectIntentCompiler(env: CompilerEnvironment = process.env): CompilerSelection {
  if (env.OPENAI_API_KEY) {
    return {
      compiler: new OpenAIIntentCompiler({
        apiKey: env.OPENAI_API_KEY,
        ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {}),
      }),
      reason: 'OPENAI_API_KEY is configured; intents are compiled by the OpenAI model.',
    };
  }

  const fallbackAllowed = (env.INTENTPROOF_ALLOW_FALLBACK_COMPILER ?? 'true') !== 'false';
  if (!fallbackAllowed) {
    throw new Error(
      'OPENAI_API_KEY is not set and the rule-based fallback compiler is disabled.',
    );
  }

  return {
    compiler: new DeterministicIntentCompiler(),
    reason:
      'No OPENAI_API_KEY is configured, so a rule-based parser drafted this policy. No language model was involved.',
  };
}
