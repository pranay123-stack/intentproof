import { STARKNET_ADDRESS_PATTERN } from './constants.js';

/**
 * A protocol the user's policy may name.
 *
 * The MVP ships a directory of *labels*, not addresses. Publishing invented
 * Starknet addresses for real protocols would be worse than useless — it would
 * be a fabricated allowlist that looks authoritative. A production deployment
 * replaces `address: null` with an audited, verified contract address and the
 * engine then pins the allowlist to that address instead of the label.
 */
export interface ProtocolEntry {
  readonly id: string;
  readonly displayName: string;
  readonly category: 'dex' | 'lending' | 'staking' | 'bridge';
  readonly address: string | null;
  readonly note: string;
}

export const PROTOCOL_DIRECTORY: readonly ProtocolEntry[] = [
  {
    id: 'APPROVED_DEX_1',
    displayName: 'Approved DEX 1',
    category: 'dex',
    address: null,
    note: 'Placeholder label for an audited Starknet AMM. Bind to an address before mainnet use.',
  },
  {
    id: 'APPROVED_DEX_2',
    displayName: 'Approved DEX 2',
    category: 'dex',
    address: null,
    note: 'Second approved venue, so routing has a real choice in the demo.',
  },
  {
    id: 'APPROVED_STAKING_1',
    displayName: 'Approved Staking 1',
    category: 'staking',
    address: null,
    note: 'Liquid staking venue used by the "stake STRK" scenarios.',
  },
  {
    id: 'APPROVED_LENDING_1',
    displayName: 'Approved Lending 1',
    category: 'lending',
    address: null,
    note: 'Present so that "never borrow" has something concrete to forbid.',
  },
] as const;

const BY_ID = new Map(PROTOCOL_DIRECTORY.map((p) => [p.id.toUpperCase(), p]));

export function lookupProtocol(id: string): ProtocolEntry | undefined {
  return BY_ID.get(id.trim().toUpperCase());
}

export function isStarknetAddress(value: string): boolean {
  return STARKNET_ADDRESS_PATTERN.test(value.trim());
}

/**
 * A contract id is resolvable if it is a known directory label or a literal
 * Starknet address. Anything else — including a plausible-looking protocol name
 * the model invented — is refused at compile time.
 */
export function isResolvableContractId(id: string): boolean {
  return isStarknetAddress(id) || BY_ID.has(id.trim().toUpperCase());
}

export function describeContractId(id: string): string {
  const entry = lookupProtocol(id);
  if (entry) return entry.displayName;
  if (isStarknetAddress(id)) return `${id.slice(0, 10)}…${id.slice(-4)}`;
  return id;
}
