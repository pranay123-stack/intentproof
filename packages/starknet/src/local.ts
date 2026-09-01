import type { ChainAnchor } from '@intentproof/intent-schema';
import type {
  OnChainIntent,
  OnChainVerification,
  RegistrationResult,
  RegistryClient,
} from './client.js';

/**
 * LOCAL DEMO MODE.
 *
 * Commitments are real — the same canonicalization and the same Poseidon hash
 * the chain would compute. What is absent is the chain, and this client makes
 * that absence structural: every method that would return a `ChainAnchor`
 * returns `null`, so no caller can accidentally render a transaction hash.
 * Nothing here generates a plausible-looking hash to fill a gap.
 */
export class LocalRegistryClient implements RegistryClient {
  readonly mode = 'LOCAL_DEMO' as const;
  readonly network: string;
  readonly contractAddress = null;
  readonly canWrite = false;
  readonly description =
    'LOCAL DEMO MODE — commitments and policy enforcement are real; nothing is written to a blockchain.';

  constructor(network = 'starknet-sepolia') {
    this.network = network;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async registerIntent(): Promise<RegistrationResult> {
    return { anchor: null, onChainIntentId: null };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async revokeIntent(): Promise<ChainAnchor | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async recordExecution(): Promise<ChainAnchor | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIntent(): Promise<OnChainIntent | null> {
    return null;
  }

  /**
   * Returns `null`, not `{verified: false}`. "The chain has no opinion" and
   * "the chain says no" are different answers and the UI shows them differently.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async verifyExecution(): Promise<OnChainVerification | null> {
    return null;
  }
}
