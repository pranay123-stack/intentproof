import {
  IntentProposalSchema,
  PROTOCOL_DIRECTORY,
  type IntentProposal,
} from '@intentproof/intent-schema';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { finalizeProposal } from './normalize.js';
import {
  SYSTEM_PROMPT,
  assertUsableInput,
  protocolDirectoryPrompt,
  wrapUserInput,
} from './prompt.js';
import {
  CompilationError,
  type CompileOptions,
  type CompileResult,
  type IntentCompiler,
} from './types.js';

/** Default model. Override with `OPENAI_MODEL`. */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6';

/** Cap on generation. A proposal is small; a long one is a malfunction. */
const MAX_OUTPUT_TOKENS = 2_000;

export interface OpenAIIntentCompilerOptions {
  readonly apiKey?: string;
  readonly model?: string;
  /** Pre-built client. Tests inject a stub; production passes nothing. */
  readonly client?: OpenAI;
  readonly baseURL?: string;
  readonly maxRetries?: number;
}

interface RefusalContent {
  type: string;
  refusal?: string;
}

interface OutputMessage {
  type?: string;
  content?: RefusalContent[];
}

function findRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output as OutputMessage[]) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
    }
  }
  return null;
}

/**
 * The natural-language front door.
 *
 * What this class is allowed to do is narrow by construction: it turns prose
 * into an `IntentProposal` and hands it to `finalizeProposal`. It never sees a
 * private key, never touches the policy engine, and never decides whether
 * anything is authorized. If it returns garbage, the schema gate rejects it; if
 * it returns something plausible but wrong, the human review step is what
 * catches it.
 *
 * The API key is read from the environment on the server only. This module has
 * no browser entry point and the key never appears in a `NEXT_PUBLIC_*` name.
 */
export class OpenAIIntentCompiler implements IntentCompiler {
  readonly id = 'openai-intent-compiler';
  readonly kind = 'llm' as const;
  readonly model: string;
  readonly #client: OpenAI;

  constructor(options: OpenAIIntentCompilerOptions = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    if (options.client) {
      this.#client = options.client;
    } else {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY is not set. The Intent Compiler runs server-side only; set it in .env.local.',
        );
      }
      this.#client = new OpenAI({
        apiKey,
        maxRetries: options.maxRetries ?? 2,
        ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      });
    }
  }

  async compile(input: string, options: CompileOptions = {}): Promise<CompileResult> {
    let text: string;
    try {
      text = assertUsableInput(input);
    } catch (error) {
      throw new CompilationError('input', (error as Error).message);
    }

    const now = options.now ?? new Date();
    const startedAt = Date.now();

    let response: Awaited<ReturnType<typeof this.parseOnce>>;
    try {
      response = await this.parseOnce(text, options.signal);
    } catch (error) {
      // Deliberately does not include the prompt or the model's text in the
      // message: compilation errors surface to the browser and to logs.
      const detail = error instanceof OpenAI.APIError ? `${error.status} ${error.name}` : 'request failed';
      throw new CompilationError('request', `The Intent Compiler could not reach OpenAI (${detail}).`);
    }

    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason ?? 'unknown';
      throw new CompilationError(
        'request',
        `The model stopped before finishing the proposal (${reason}). Try a shorter description.`,
      );
    }

    const refusal = findRefusal(response.output);
    if (refusal !== null) {
      throw new CompilationError('refusal', 'The model declined to interpret this description.');
    }

    const parsed = IntentProposalSchema.safeParse(response.output_parsed);
    if (!parsed.success) {
      throw new CompilationError(
        'schema',
        'The model returned a proposal that does not match the intent schema.',
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      );
    }

    const proposal: IntentProposal = parsed.data;
    const { policy, warnings } = finalizeProposal(proposal, now);

    const usage = response.usage;
    return {
      policy,
      proposal,
      warnings,
      provenance: {
        compilerId: this.id,
        kind: this.kind,
        model: this.model,
        createdAt: now.toISOString(),
        durationMs: Date.now() - startedAt,
        isModelGenerated: true,
        ...(response.id ? { requestId: response.id } : {}),
        ...(usage
          ? {
              usage: {
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
              },
            }
          : {}),
      },
    };
  }

  private parseOnce(text: string, signal?: AbortSignal) {
    return this.#client.responses.parse(
      {
        model: this.model,
        instructions: SYSTEM_PROMPT,
        input: [
          {
            role: 'developer',
            content: protocolDirectoryPrompt(
              PROTOCOL_DIRECTORY.map((p) => ({
                id: p.id,
                displayName: p.displayName,
                category: p.category,
              })),
            ),
          },
          { role: 'user', content: wrapUserInput(text) },
        ],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: zodTextFormat(IntentProposalSchema, 'intent_policy_proposal') },
        // The prose is not ours to retain and the user did not ask us to store it.
        store: false,
      },
      signal ? { signal } : undefined,
    );
  }
}
