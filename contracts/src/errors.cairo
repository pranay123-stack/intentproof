//! Short-string error codes.
//!
//! Every failure path in IntentProof reports a stable code rather than a free-form
//! message: off-chain verifiers compare codes, so they must never drift.

pub mod Errors {
    pub const INTENT_EXISTS: felt252 = 'IP: intent exists';
    pub const INTENT_UNKNOWN: felt252 = 'IP: unknown intent';
    pub const NOT_CREATOR: felt252 = 'IP: not intent creator';
    pub const NOT_AUTHORIZED_AGENT: felt252 = 'IP: agent not authorized';
    pub const ALREADY_REVOKED: felt252 = 'IP: already revoked';
    pub const REVOKED: felt252 = 'IP: intent revoked';
    pub const EXPIRED: felt252 = 'IP: intent expired';
    pub const BAD_EXPIRY: felt252 = 'IP: expiry in the past';
    pub const ZERO_HASH: felt252 = 'IP: zero intent hash';
    pub const ZERO_RECEIPT: felt252 = 'IP: zero receipt hash';
    pub const HASH_MISMATCH: felt252 = 'IP: policy hash mismatch';
    pub const REPLAY: felt252 = 'IP: receipt already recorded';
    pub const TX_LIMIT: felt252 = 'IP: tx value over limit';
    pub const DAILY_LIMIT: felt252 = 'IP: daily spend over limit';
    pub const UNKNOWN_EXECUTION: felt252 = 'IP: unknown execution';
    pub const PAUSED: felt252 = 'IP: registry paused';
    pub const NOT_OWNER: felt252 = 'IP: caller is not the owner';
    pub const ZERO_OWNER: felt252 = 'IP: owner is the zero address';
    pub const NOT_PENDING_OWNER: felt252 = 'IP: not the pending owner';
    pub const EMPTY_CANONICAL: felt252 = 'IP: empty canonical form';
    pub const VERSION_ZERO: felt252 = 'IP: version must be non-zero';
}
