//! Pure policy primitives.
//!
//! Nothing in this module touches storage or the caller, so every function here
//! is reusable by any Starknet contract that wants to enforce IntentProof-shaped
//! authorization without depending on our registry. The registry composes these
//! same functions, which is what keeps on-chain and off-chain enforcement in step.

use core::poseidon::poseidon_hash_span;
use crate::errors::Errors;
use crate::types::{VerificationResult, failed, ok};

/// Seconds in a spend-accounting day. Daily limits bucket by UTC day index.
pub const SECONDS_PER_DAY: u64 = 86400;

/// Numeric limits mirrored on-chain from the approved policy.
#[derive(Drop, Serde, Copy, Debug)]
pub struct PolicyBounds {
    pub max_tx_value_usd_cents: u128,
    pub max_daily_spend_usd_cents: u128,
    pub max_slippage_bps: u32,
    pub expires_at: u64,
}

/// Poseidon commitment over the canonical policy encoding.
///
/// The off-chain canonicalizer splits the canonical JSON into 31-byte big-endian
/// chunks and hashes them with the same Poseidon sponge, so this function
/// reproduces the intent hash exactly. That is what makes the commitment
/// checkable on-chain rather than merely stored.
pub fn compute_policy_hash(canonical_chunks: Span<felt252>) -> felt252 {
    poseidon_hash_span(canonical_chunks)
}

/// UTC day bucket used for daily spend accounting.
pub fn day_index(timestamp: u64) -> u64 {
    timestamp / SECONDS_PER_DAY
}

/// Membership test used for action / asset / contract allowlists.
pub fn contains(haystack: Span<felt252>, needle: felt252) -> bool {
    let mut i = 0_usize;
    let mut found = false;
    while i < haystack.len() {
        if *haystack.at(i) == needle {
            found = true;
            break;
        }
        i += 1;
    }
    found
}

pub fn check_action_allowed(action: felt252, allowed: Span<felt252>) -> bool {
    contains(allowed, action)
}

/// Forbidden actions are checked separately from the allowlist and take
/// precedence: an action named in both lists is rejected.
pub fn check_not_forbidden(action: felt252, forbidden: Span<felt252>) -> bool {
    !contains(forbidden, action)
}

pub fn check_asset_allowed(asset: felt252, allowed: Span<felt252>) -> bool {
    contains(allowed, asset)
}

pub fn check_contract_allowed(target: felt252, allowed: Span<felt252>) -> bool {
    contains(allowed, target)
}

pub fn check_transaction_value(value_usd_cents: u128, max_usd_cents: u128) -> bool {
    value_usd_cents <= max_usd_cents
}

/// `spent_today + value` must stay within the daily cap. Written with a
/// subtraction so an overflowing addition can never wrap into a pass.
pub fn check_daily_spend(
    spent_today_usd_cents: u128, value_usd_cents: u128, max_daily_usd_cents: u128,
) -> bool {
    if spent_today_usd_cents > max_daily_usd_cents {
        return false;
    }
    value_usd_cents <= max_daily_usd_cents - spent_today_usd_cents
}

pub fn check_slippage(slippage_bps: u32, max_slippage_bps: u32) -> bool {
    slippage_bps <= max_slippage_bps
}

pub fn check_not_expired(expires_at: u64, now: u64) -> bool {
    now < expires_at
}

pub fn check_not_revoked(revoked_at: u64) -> bool {
    revoked_at == 0
}

/// A receipt hash may be recorded at most once per intent.
pub fn check_no_replay(already_recorded: bool) -> bool {
    !already_recorded
}

pub fn check_hash_integrity(canonical_chunks: Span<felt252>, expected: felt252) -> bool {
    compute_policy_hash(canonical_chunks) == expected
}

/// Full on-chain evaluation of the checks the registry can perform unaided.
///
/// Returns the first failing rule, in the same order the off-chain engine
/// evaluates them, so the two implementations agree on *why* something failed.
pub fn evaluate(
    bounds: PolicyBounds,
    revoked_at: u64,
    now: u64,
    already_recorded: bool,
    spent_today_usd_cents: u128,
    value_usd_cents: u128,
) -> VerificationResult {
    if !check_not_revoked(revoked_at) {
        return failed(Errors::REVOKED);
    }
    if !check_not_expired(bounds.expires_at, now) {
        return failed(Errors::EXPIRED);
    }
    if !check_no_replay(already_recorded) {
        return failed(Errors::REPLAY);
    }
    if !check_transaction_value(value_usd_cents, bounds.max_tx_value_usd_cents) {
        return failed(Errors::TX_LIMIT);
    }
    if !check_daily_spend(
        spent_today_usd_cents, value_usd_cents, bounds.max_daily_spend_usd_cents,
    ) {
        return failed(Errors::DAILY_LIMIT);
    }
    ok()
}
