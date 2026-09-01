import { LocalRegistryClient } from './local.js';
import { StarknetRegistryClient } from './chain.js';
import { resolveNetwork } from './networks.js';
import type { RegistryClient } from './client.js';

/** Shaped to accept `process.env` directly as well as a hand-built object. */
export interface StarknetEnvironment {
  readonly [key: string]: string | undefined;
  readonly STARKNET_RPC_URL?: string | undefined;
  readonly STARKNET_ACCOUNT_ADDRESS?: string | undefined;
  readonly STARKNET_PRIVATE_KEY?: string | undefined;
  readonly INTENT_REGISTRY_ADDRESS?: string | undefined;
  readonly NEXT_PUBLIC_STARKNET_NETWORK?: string | undefined;
}

export interface RegistrySelection {
  readonly client: RegistryClient;
  /** Shown in the UI verbatim so the operating mode is never ambiguous. */
  readonly reason: string;
}

/**
 * Choose a registry client from the environment.
 *
 * A registry address is the deciding factor: without one there is nothing to
 * talk to, so local mode is the honest answer. With an address but no key we
 * still connect — reading and verifying existing intents is genuinely useful,
 * and it is better than pretending the chain is unreachable.
 */
export function selectRegistryClient(env: StarknetEnvironment = process.env): RegistrySelection {
  const network = resolveNetwork(env.NEXT_PUBLIC_STARKNET_NETWORK);
  const address = env.INTENT_REGISTRY_ADDRESS?.trim();

  if (!address) {
    return {
      client: new LocalRegistryClient(network),
      reason:
        'INTENT_REGISTRY_ADDRESS is not set, so IntentProof is running in LOCAL DEMO MODE. Commitments and enforcement are real; nothing is written to a blockchain.',
    };
  }

  const client = new StarknetRegistryClient({
    network,
    contractAddress: address,
    ...(env.STARKNET_RPC_URL ? { rpcUrl: env.STARKNET_RPC_URL } : {}),
    ...(env.STARKNET_ACCOUNT_ADDRESS ? { accountAddress: env.STARKNET_ACCOUNT_ADDRESS } : {}),
    ...(env.STARKNET_PRIVATE_KEY ? { privateKey: env.STARKNET_PRIVATE_KEY } : {}),
  });

  return { client, reason: client.description };
}
