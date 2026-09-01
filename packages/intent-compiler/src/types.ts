import type { IntentPolicy, IntentProposal, SemanticIssue } from '@intentproof/intent-schema';

export type CompilerKind = 'llm' | 'deterministic';

export interface CompilerProvenance {
  /** Stable identifier for the compiler that produced this policy. */
  readonly compilerId: string;
  readonly kind: CompilerKind;
  /** Model id for LLM compilers; `null` for deterministic ones. */
  readonly model: string | null;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly requestId?: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /**
   * Set when the policy did not come from a language model, so an integrator can
   * say so rather than implying an AI interpreted the request.
   */
  readonly isModelGenerated: boolean;
}

export interface CompileResult {
  readonly policy: IntentPolicy;
  /** The raw structured proposal, before normalization. Kept for auditability. */
  readonly proposal: IntentProposal;
  readonly provenance: CompilerProvenance;
  /** Non-blocking semantic observations worth showing the user before approval. */
  readonly warnings: readonly string[];
}

export interface CompileOptions {
  /** Clock injection so tests and replays are deterministic. */
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

/**
 * The provider boundary.
 *
 * Everything downstream — canonicalization, hashing, the policy engine, the
 * contracts — is written against `CompileResult`, never against a provider SDK.
 * Adding Anthropic or a local model means adding one implementation of this
 * interface and changing nothing else.
 */
export interface IntentCompiler {
  readonly id: string;
  readonly kind: CompilerKind;
  readonly model: string | null;
  compile(input: string, options?: CompileOptions): Promise<CompileResult>;
}

export type CompilationStage = 'input' | 'request' | 'refusal' | 'schema' | 'semantic';

/** A compilation that produced no policy. No intent is ever created from one. */
export class CompilationError extends Error {
  readonly stage: CompilationStage;
  readonly issues: readonly string[];
  readonly semanticIssues: readonly SemanticIssue[];

  constructor(
    stage: CompilationStage,
    message: string,
    issues: readonly string[] = [],
    semanticIssues: readonly SemanticIssue[] = [],
  ) {
    super(message);
    this.name = 'CompilationError';
    this.stage = stage;
    this.issues = issues;
    this.semanticIssues = semanticIssues;
  }
}
