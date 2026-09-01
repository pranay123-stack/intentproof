/** Networks IntentProof knows how to talk to. */
export const NETWORKS = {
  'starknet-sepolia': {
    id: 'starknet-sepolia',
    displayName: 'Starknet Sepolia',
    /** Verified working public endpoint; override with STARKNET_RPC_URL. */
    defaultRpcUrl: 'https://starknet-sepolia.drpc.org',
    explorer: 'https://sepolia.starkscan.co',
    secondaryExplorer: 'https://sepolia.voyager.online',
  },
  'starknet-mainnet': {
    id: 'starknet-mainnet',
    displayName: 'Starknet Mainnet',
    defaultRpcUrl: 'https://starknet-mainnet.drpc.org',
    explorer: 'https://starkscan.co',
    secondaryExplorer: 'https://voyager.online',
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

export function resolveNetwork(name: string | undefined): NetworkId {
  const key = (name ?? 'sepolia').toLowerCase();
  if (key === 'mainnet' || key === 'starknet-mainnet') return 'starknet-mainnet';
  return 'starknet-sepolia';
}

/**
 * Explorer links are only ever produced for a hash we received from a node.
 * There is no code path that builds one from a locally computed value.
 */
export function transactionUrl(network: NetworkId, transactionHash: string): string {
  return `${NETWORKS[network].explorer}/tx/${transactionHash}`;
}

export function contractUrl(network: NetworkId, address: string): string {
  return `${NETWORKS[network].explorer}/contract/${address}`;
}

export function secondaryTransactionUrl(network: NetworkId, transactionHash: string): string {
  return `${NETWORKS[network].secondaryExplorer}/tx/${transactionHash}`;
}
