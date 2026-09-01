import { usdToCents, type ChainAnchor } from '@intentproof/intent-schema';
import {
  Account,
  Contract,
  RpcProvider,
  shortString,
  type GetTransactionReceiptResponse,
} from 'starknet';
import { INTENT_REGISTRY_ABI } from './abi/intent-registry.js';
import {
  ReadOnlyRegistryError,
  type OnChainIntent,
  type OnChainVerification,
  type RecordExecutionInput,
  type RegisterIntentInput,
  type RegistrationResult,
  type RegistryClient,
} from './client.js';
import { NETWORKS, contractUrl, transactionUrl, type NetworkId } from './networks.js';

export interface StarknetRegistryClientOptions {
  readonly network: NetworkId;
  readonly rpcUrl?: string;
  readonly contractAddress: string;
  readonly accountAddress?: string;
  readonly privateKey?: string;
  /** Agent account allowed to record executions. Defaults to the signer. */
  readonly agentAddress?: string;
}

const toHex = (value: unknown): string => {
  if (typeof value === 'bigint') return `0x${value.toString(16)}`;
  if (typeof value === 'string') return value.startsWith('0x') ? value : `0x${BigInt(value).toString(16)}`;
  if (typeof value === 'number') return `0x${value.toString(16)}`;
  return '0x0';
};

const toNumber = (value: unknown): number => Number(value ?? 0);
const toBigInt = (value: unknown): bigint => BigInt((value ?? 0) as string | number | bigint);

/** Decode a Cairo short-string error code back into readable text. */
export function decodeFailureCode(value: unknown): string | null {
  const raw = toBigInt(value);
  if (raw === 0n) return null;
  try {
    return shortString.decodeShortString(`0x${raw.toString(16)}`);
  } catch {
    return `0x${raw.toString(16)}`;
  }
}

/** Cents as a u128 argument. Throws rather than silently truncating. */
function centsArg(usd: number | undefined): bigint {
  const cents = usdToCents(usd ?? 0);
  if (cents === null || cents < 0) throw new RangeError(`invalid USD amount: ${usd}`);
  return BigInt(cents);
}

/**
 * The real thing: an `IntentRegistry` deployed on Starknet.
 *
 * Registration uses `register_intent_from_canonical`, which hands the contract
 * the canonical chunks and makes *it* recompute the Poseidon commitment. The
 * cheaper `register_intent` would have the chain take our word for the hash;
 * paying for the recomputation is what turns "we say this policy hashes to X"
 * into something the network checked.
 */
export class StarknetRegistryClient implements RegistryClient {
  readonly mode = 'STARKNET_SEPOLIA' as const;
  readonly network: NetworkId;
  readonly contractAddress: string;
  readonly canWrite: boolean;
  readonly description: string;

  readonly #provider: RpcProvider;
  readonly #account: Account | null;
  readonly #agentAddress: string | null;
  readonly #read: Contract;

  constructor(options: StarknetRegistryClientOptions) {
    this.network = options.network;
    this.contractAddress = options.contractAddress;
    this.#provider = new RpcProvider({
      nodeUrl: options.rpcUrl ?? NETWORKS[options.network].defaultRpcUrl,
    });

    if (options.privateKey && options.accountAddress) {
      this.#account = new Account({
        provider: this.#provider,
        address: options.accountAddress,
        signer: options.privateKey,
      });
      this.canWrite = true;
      this.description = `Connected to ${NETWORKS[options.network].displayName}; intents are committed on chain.`;
    } else {
      this.#account = null;
      this.canWrite = false;
      this.description = `Connected to ${NETWORKS[options.network].displayName} in read-only mode: no STARKNET_PRIVATE_KEY, so existing intents can be read and verified but no new ones written.`;
    }

    this.#agentAddress = options.agentAddress ?? options.accountAddress ?? null;
    this.#read = new Contract({
      abi: INTENT_REGISTRY_ABI,
      address: options.contractAddress,
      providerOrAccount: this.#provider,
    });
  }

  #writer(operation: string): Contract {
    if (!this.#account) throw new ReadOnlyRegistryError(operation);
    return new Contract({
      abi: INTENT_REGISTRY_ABI,
      address: this.contractAddress,
      providerOrAccount: this.#account,
    });
  }

  /** Only ever called with a hash that came back from a node. */
  #anchor(
    transactionHash: string,
    receipt: GetTransactionReceiptResponse | null,
    onChainIntentId: number | null,
  ): ChainAnchor {
    const blockNumber =
      receipt && 'block_number' in receipt && typeof receipt.block_number === 'number'
        ? receipt.block_number
        : null;
    return {
      network: this.network,
      contractAddress: this.contractAddress,
      transactionHash,
      blockNumber,
      onChainIntentId: onChainIntentId === null ? null : String(onChainIntentId),
      explorerUrl: transactionUrl(this.network, transactionHash),
    };
  }

  get contractExplorerUrl(): string {
    return contractUrl(this.network, this.contractAddress);
  }

  async registerIntent(input: RegisterIntentInput): Promise<RegistrationResult> {
    const contract = this.#writer('register an intent');
    const chunks = canonicalChunks(input.canonical);
    const expiresAt = Math.floor(Date.parse(input.policy.expiresAt) / 1000);

    const call = contract.populate('register_intent_from_canonical', [
      chunks,
      {
        intent_hash: input.intentHash,
        version: input.policy.version,
        expires_at: expiresAt,
        max_tx_value_usd_cents: centsArg(input.policy.maxTransactionValueUsd),
        max_daily_spend_usd_cents: centsArg(input.policy.maxDailySpendUsd),
        agent: input.agentAddress ?? this.#agentAddress ?? '0x0',
      },
    ]);

    const { transaction_hash } = await this.#account!.execute(call);
    const receipt = await this.#provider.waitForTransaction(transaction_hash);
    const onChain = await this.getIntent(input.intentHash);
    return {
      anchor: this.#anchor(transaction_hash, receipt, onChain?.id ?? null),
      onChainIntentId: onChain?.id ?? null,
    };
  }

  async revokeIntent(intentHash: string): Promise<ChainAnchor | null> {
    const contract = this.#writer('revoke an intent');
    const call = contract.populate('revoke_intent', [intentHash]);
    const { transaction_hash } = await this.#account!.execute(call);
    const receipt = await this.#provider.waitForTransaction(transaction_hash);
    return this.#anchor(transaction_hash, receipt, null);
  }

  async recordExecution(input: RecordExecutionInput): Promise<ChainAnchor | null> {
    const contract = this.#writer('record an execution');
    const call = contract.populate('record_execution', [
      input.intentHash,
      input.receiptHash,
      input.actionHash,
      centsArg(input.valueUsd),
    ]);
    const { transaction_hash } = await this.#account!.execute(call);
    const receipt = await this.#provider.waitForTransaction(transaction_hash);
    return this.#anchor(transaction_hash, receipt, null);
  }

  async getIntent(intentHash: string): Promise<OnChainIntent | null> {
    const raw = (await this.#read.call('get_intent', [intentHash])) as Record<string, unknown>;
    if (!raw || raw.exists !== true) return null;
    return {
      id: toNumber(raw.id),
      intentHash: toHex(raw.intent_hash),
      creator: toHex(raw.creator),
      version: toNumber(raw.version),
      createdAt: toNumber(raw.created_at),
      expiresAt: toNumber(raw.expires_at),
      revokedAt: toNumber(raw.revoked_at),
      maxTransactionValueUsdCents: toBigInt(raw.max_tx_value_usd_cents),
      maxDailySpendUsdCents: toBigInt(raw.max_daily_spend_usd_cents),
      executionCount: toNumber(raw.execution_count),
      totalSpendUsdCents: toBigInt(raw.total_spend_usd_cents),
      exists: true,
    };
  }

  async verifyExecution(
    intentHash: string,
    receiptHash: string,
  ): Promise<OnChainVerification | null> {
    const raw = (await this.#read.call('verify_execution', [intentHash, receiptHash])) as Record<
      string,
      unknown
    >;
    return {
      verified: raw.verified === true || toBigInt(raw.verified) === 1n,
      failureCode: decodeFailureCode(raw.failure_code),
    };
  }

  /** Ask the chain to recompute a commitment. Used by the verification page. */
  async computePolicyHash(canonical: string): Promise<string> {
    const raw = await this.#read.call('compute_policy_hash', [canonicalChunks(canonical)]);
    return toHex(raw);
  }
}

function canonicalChunks(canonical: string): string[] {
  const bytes = new TextEncoder().encode(canonical);
  const chunks: string[] = [`0x${bytes.length.toString(16)}`];
  for (let i = 0; i < bytes.length; i += 31) {
    let value = 0n;
    for (const byte of bytes.subarray(i, i + 31)) value = (value << 8n) | BigInt(byte);
    chunks.push(`0x${value.toString(16)}`);
  }
  return chunks;
}

export { canonicalChunks };
