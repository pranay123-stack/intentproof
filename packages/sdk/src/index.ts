import {
  evaluateAction,
  type EvaluationResult,
  type LedgerSnapshot,
} from '@intentproof/policy-engine';
import type { AgentAction, AuthorizedIntent } from '@intentproof/intent-schema';
import { IntentProofClient, type IntentProofOptions } from './client.js';
import { verifyExecution } from './verify.js';

export * from './client.js';
export * from './verify.js';

// Re-exported so an integrator needs one dependency, not five.
export type {
  ActionKind,
  AgentAction,
  AuthorizedIntent,
  ChainAnchor,
  ExecutionMode,
  ExecutionReceipt,
  IntentPolicy,
  IntentProposal,
  PolicyCheck,
} from '@intentproof/intent-schema';
export {
  ACTION_KINDS,
  AgentActionSchema,
  ExecutionReceiptSchema,
  IntentPolicySchema,
  IntentProposalSchema,
  PROTOCOL_DIRECTORY,
  buildReceipt,
  canonicalPolicyJson,
  commitPolicy,
  computeActionHash,
  computeIntentHash,
  computeReceiptHash,
  intentDisplayNumber,
  intentStatus,
  receiptIsIntact,
  validatePolicySemantics,
} from '@intentproof/intent-schema';
export {
  CHECK_ORDER,
  EMPTY_LEDGER,
  PolicyEngine,
  applyToLedger,
  dayIndex,
  evaluateAction,
  ledgerFromHistory,
  replayReceipt,
  type EvaluationResult,
  type LedgerSnapshot,
} from '@intentproof/policy-engine';
export {
  DeterministicIntentCompiler,
  OpenAIIntentCompiler,
  StaticIntentCompiler,
  CompilationError,
  selectIntentCompiler,
  type IntentCompiler,
} from '@intentproof/intent-compiler';
export {
  LocalRegistryClient,
  StarknetRegistryClient,
  selectRegistryClient,
  transactionUrl,
  contractUrl,
  type RegistryClient,
} from '@intentproof/starknet';
export {
  AgentSimulator,
  DEMO_SCENARIO,
  driftingStrategy,
  rebalanceStrategy,
  scenarioStrategy,
} from '@intentproof/agent';

let shared: IntentProofClient | null = null;

/**
 * Convenience facade over a lazily built client.
 *
 * ```ts
 * import { IntentProof } from '@intentproof/sdk';
 *
 * const compiled = await IntentProof.compileIntent({ naturalLanguage: '…' });
 * const { intent } = await IntentProof.authorize({ policy: compiled.policy });
 * const result = IntentProof.checkAction(intent, action);
 * if (!result.allowed) throw new Error('Intent violation');
 * ```
 */
export const IntentProof = {
  /** Build an isolated client — preferred in servers handling many users. */
  create(options: IntentProofOptions = {}): IntentProofClient {
    return new IntentProofClient(options);
  },

  /** The process-wide client, configured from the environment on first use. */
  shared(): IntentProofClient {
    shared ??= new IntentProofClient();
    return shared;
  },

  compileIntent(input: Parameters<IntentProofClient['compileIntent']>[0]) {
    return IntentProof.shared().compileIntent(input);
  },

  authorize(input: Parameters<IntentProofClient['authorize']>[0]) {
    return IntentProof.shared().authorize(input);
  },

  checkAction(
    intent: AuthorizedIntent,
    action: AgentAction,
    ledger?: LedgerSnapshot,
  ): EvaluationResult {
    return IntentProof.shared().checkAction(intent, action, ledger);
  },

  /**
   * Deterministic check with no client, no environment and no I/O.
   *
   * The same function the engine uses internally, exposed so an integrator can
   * enforce a policy inside their own agent loop without adopting anything else
   * from this SDK.
   */
  checkPolicy(
    intent: AuthorizedIntent,
    action: AgentAction,
    options: { now?: Date; ledger?: LedgerSnapshot } = {},
  ): EvaluationResult {
    return evaluateAction({
      intent,
      action,
      ...(options.now ? { now: options.now } : {}),
      ...(options.ledger ? { ledger: options.ledger } : {}),
    });
  },

  verify(input: Parameters<IntentProofClient['verify']>[0]) {
    return IntentProof.shared().verify(input);
  },

  /** Offline verification: local checks only, no chain lookup. */
  verifyOffline: verifyExecution,
};
