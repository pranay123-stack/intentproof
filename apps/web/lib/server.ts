import 'server-only';
import {
  IntentProofClient,
  selectIntentCompiler,
  selectRegistryClient,
  contractUrl,
  type RegistryClient,
} from '@intentproof/sdk';
import type { IntentCompiler } from '@intentproof/intent-compiler';

export interface RuntimeStatus {
  readonly compiler: {
    readonly id: string;
    readonly kind: 'llm' | 'deterministic';
    readonly model: string | null;
    readonly isModelGenerated: boolean;
    readonly reason: string;
  };
  readonly registry: {
    readonly mode: 'LOCAL_DEMO' | 'STARKNET_SEPOLIA';
    readonly network: string;
    readonly contractAddress: string | null;
    readonly contractExplorerUrl: string | null;
    readonly canWrite: boolean;
    readonly reason: string;
  };
}

interface Runtime {
  readonly sdk: IntentProofClient;
  readonly compiler: IntentCompiler | null;
  readonly compilerError: string | null;
  readonly registry: RegistryClient;
  readonly status: RuntimeStatus;
}

const globalRef = globalThis as unknown as { __intentproofRuntime?: Runtime };

/**
 * Builds the server-side runtime once per process.
 *
 * A missing or misconfigured OpenAI key must not take the whole app down — the
 * verification pages, the intent list and the policy engine all work without
 * one — so a compiler that fails to construct is captured as an error string and
 * surfaced on the one route that needs it.
 */
function build(): Runtime {
  const registrySelection = selectRegistryClient(process.env);

  let compiler: IntentCompiler | null = null;
  let compilerError: string | null = null;
  let compilerReason: string;
  try {
    const selection = selectIntentCompiler(process.env);
    compiler = selection.compiler;
    compilerReason = selection.reason;
  } catch (error) {
    compilerError = (error as Error).message;
    compilerReason = compilerError;
  }

  const sdk = new IntentProofClient({
    ...(compiler ? { compiler } : {}),
    registry: registrySelection.client,
    agentId: 'agent_demo_001',
    creator: process.env.STARKNET_ACCOUNT_ADDRESS ?? 'local',
  });

  const registry = registrySelection.client;
  const network = registry.network === 'starknet-mainnet' ? 'starknet-mainnet' : 'starknet-sepolia';

  return {
    sdk,
    compiler,
    compilerError,
    registry,
    status: {
      compiler: {
        id: compiler?.id ?? 'unavailable',
        kind: compiler?.kind ?? 'deterministic',
        model: compiler?.model ?? null,
        isModelGenerated: compiler?.kind === 'llm',
        reason: compilerReason,
      },
      registry: {
        mode: registry.mode,
        network: registry.network,
        contractAddress: registry.contractAddress,
        contractExplorerUrl: registry.contractAddress
          ? contractUrl(network, registry.contractAddress)
          : null,
        canWrite: registry.canWrite,
        reason: registrySelection.reason,
      },
    },
  };
}

export function runtime(): Runtime {
  globalRef.__intentproofRuntime ??= build();
  return globalRef.__intentproofRuntime;
}

export function runtimeStatus(): RuntimeStatus {
  return runtime().status;
}
