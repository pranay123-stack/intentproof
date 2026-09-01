/** Version of the canonical encoding. Bumping it changes every hash, by design. */
export const CANONICAL_FORM_VERSION = 1;

/** Version of the policy document shape the compiler emits and the engine reads. */
export const INTENT_POLICY_VERSION = 1;

/** Version of the execution receipt shape. */
export const RECEIPT_VERSION = 1;

/**
 * Longest authorization we will commit to. A grant of authority with no
 * practical horizon is the failure mode this project exists to prevent, so the
 * ceiling is enforced in code rather than left to the model's judgement.
 */
export const MAX_INTENT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Shortest useful authorization; below this the intent expires before use. */
export const MIN_INTENT_TTL_SECONDS = 60;

/** 100% in basis points. */
export const MAX_SLIPPAGE_BPS = 10_000;

/**
 * Slippage above this is refused outright: at 50% the "swap" is a donation, and
 * no plausible natural-language instruction means it.
 */
export const MAX_ACCEPTABLE_SLIPPAGE_BPS = 5_000;

/** Bytes packed into one felt252. 31, not 32, because the field is < 2^252. */
export const BYTES_PER_FELT = 31;

export const STARKNET_ADDRESS_PATTERN = /^0x0*[0-9a-fA-F]{1,64}$/;
