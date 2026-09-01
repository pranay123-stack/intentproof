import {
  commitPolicy,
  intentIdFromHash,
  type AgentAction,
  type AuthorizedIntent,
  type ChainAnchor,
  type ExecutionReceipt,
  type IntentPolicy,
} from '@intentproof/intent-schema';
import {
  selectIntentCompiler,
  type CompileResult,
  type IntentCompiler,
} from '@intentproof/intent-compiler';
import {
  PolicyEngine,
  evaluateAction,
  type Decision,
  type EvaluationResult,
  type LedgerSnapshot,
} from '@intentproof/policy-engine';
import {
  selectRegistryClient,
  type RegistryClient,
} from '@intentproof/starknet';
import { verifyExecution, type VerificationReport, type VerifyInput } from './verify.js';

export interface IntentProofOptions {
  readonly compiler?: IntentCompiler;
  readonly registry?: RegistryClient;
  readonly clock?: () => Date;
  readonly agentId?: string;
  readonly creator?: string;
}

export interface CompileIntentInput {
  readonly naturalLanguage: string;
  readonly signal?: AbortSignal;
}

export interface AuthorizeInput {
  readonly policy: IntentPolicy;
  readonly agentId?: string;
  readonly creator?: string;
  readonly sequence?: number;
  /** Starknet address of the agent, when writing to chain. */
  readonly agentAddress?: string;
}

export interface AuthorizeResult {
  readonly intent: AuthorizedIntent;
  /** Present when the commitment reached a chain; `null` in LOCAL DEMO MODE. */
  readonly anchor: ChainAnchor | null;
}

/**
 * The SDK surface.
 *
 * Deliberately shaped so the safe path is the short one: `compileIntent` cannot
 * authorize, `authorize` requires a policy a human has already seen, and
 * `checkAction` is the only way to get a verdict. There is no method that
 * evaluates an action against anything other than the deterministic engine, and
 * no method that takes a model's word for whether something is permitted.
 */
export class IntentProofClient {
  readonly #compiler: IntentCompiler;
  readonly #registry: RegistryClient;
  readonly #clock: () => Date;
  readonly #agentId: string;
  readonly #creator: string;

  constructor(options: IntentProofOptions = {}) {
    this.#compiler = options.compiler ?? selectIntentCompiler().compiler;
    this.#registry = options.registry ?? selectRegistryClient().client;
    this.#clock = options.clock ?? (() => new Date());
    this.#agentId = options.agentId ?? 'agent_demo_001';
    this.#creator = options.creator ?? 'local';
  }

  get compiler(): IntentCompiler {
    return this.#compiler;
  }

  get registry(): RegistryClient {
    return this.#registry;
  }

  /** Natural language in, structured proposal out. Authorizes nothing. */
  compileIntent(input: CompileIntentInput | string): Promise<CompileResult> {
    const request = typeof input === 'string' ? { naturalLanguage: input } : input;
    return this.#compiler.compile(request.naturalLanguage, {
      now: this.#clock(),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  }

  /**
   * Commit an approved policy.
   *
   * This is the step a human must reach explicitly. The SDK cannot tell whether
   * a human actually looked, which is why the web app routes approval through a
   * separate user action and why this method is documented as taking an
   * *already approved* policy rather than a compile result.
   */
  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const { canonical, intentHash } = commitPolicy(input.policy);
    const now = this.#clock();

    const registration = await this.#registry.registerIntent({
      intentHash,
      canonical,
      policy: input.policy,
      ...(input.agentAddress ? { agentAddress: input.agentAddress } : {}),
    });

    const intent: AuthorizedIntent = {
      intentId: intentIdFromHash(intentHash),
      intentHash,
      canonical,
      policy: input.policy,
      creator: input.creator ?? this.#creator,
      agentId: input.agentId ?? this.#agentId,
      createdAt: now.toISOString(),
      expiresAt: input.policy.expiresAt,
      mode: this.#registry.mode,
      network: this.#registry.network,
      anchor: registration.anchor,
      revokedAt: null,
      revocationAnchor: null,
      sequence: input.sequence ?? 0,
    };

    return { intent, anchor: registration.anchor };
  }

  /** Deterministic evaluation of one action. No model, no network. */
  checkAction(
    intent: AuthorizedIntent,
    action: AgentAction,
    ledger?: LedgerSnapshot,
  ): EvaluationResult {
    return evaluateAction({
      intent,
      action,
      now: this.#clock(),
      ...(ledger ? { ledger } : {}),
    });
  }

  /** An engine bound to one intent, carrying the spend ledger across actions. */
  engineFor(intent: AuthorizedIntent, ledger?: LedgerSnapshot): PolicyEngine {
    return new PolicyEngine(intent, { clock: this.#clock, ...(ledger ? { ledger } : {}) });
  }

  /**
   * Record an allowed execution on chain.
   *
   * Rejected actions are never recorded: the registry would refuse them anyway,
   * and paying gas to tell the chain about something that did not happen is not
   * a feature. The rejection lives in the receipt, which is where a reader looks
   * for what the agent tried.
   */
  async recordExecution(
    intent: AuthorizedIntent,
    receipt: ExecutionReceipt,
  ): Promise<ChainAnchor | null> {
    if (receipt.policyResult !== 'ALLOWED') return null;
    if (!this.#registry.canWrite) return null;
    return this.#registry.recordExecution({
      intentHash: intent.intentHash,
      receiptHash: receipt.receiptHash,
      actionHash: receipt.actionHash,
      valueUsd: receipt.action.valueUsd,
    });
  }

  async revoke(intent: AuthorizedIntent): Promise<ChainAnchor | null> {
    if (!this.#registry.canWrite) return null;
    return this.#registry.revokeIntent(intent.intentHash);
  }

  /** Verify a receipt, consulting the chain when one is configured. */
  async verify(input: VerifyInput): Promise<VerificationReport> {
    let onChain = input.onChain ?? null;
    if (onChain === null && input.intent.mode !== 'LOCAL_DEMO') {
      try {
        onChain = await this.#registry.verifyExecution(
          input.intent.intentHash,
          input.receipt.receiptHash,
        );
      } catch {
        // A node that is unreachable must not turn into a verification failure;
        // it becomes INDETERMINATE, which is what `null` means downstream.
        onChain = null;
      }
    }
    return verifyExecution({ ...input, onChain });
  }
}

export type { Decision, EvaluationResult, CompileResult, VerificationReport };
