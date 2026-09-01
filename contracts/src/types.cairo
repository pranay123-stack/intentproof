//! Core value types shared by the registry, the verifier and downstream contracts.

use starknet::ContractAddress;

/// Lifecycle of a registered intent. `Expired` is derived from the clock rather
/// than stored, so it is never written to storage — see `Intent::status_at`.
#[derive(Drop, Serde, Copy, PartialEq, Debug, starknet::Store)]
pub enum IntentStatus {
    #[default]
    Unknown,
    Active,
    Revoked,
    Expired,
}

/// An authorization commitment: the hash of a human-approved policy plus the
/// numeric limits the chain is able to enforce on its own.
///
/// `intent_hash` is the Poseidon hash of the canonical policy encoding. The
/// registry never sees the policy text, only the commitment — but the numeric
/// limits are mirrored on-chain so that `record_execution` is a real check and
/// not a rubber stamp.
#[derive(Drop, Serde, Copy, Debug, starknet::Store)]
pub struct Intent {
    pub id: u64,
    pub intent_hash: felt252,
    pub creator: ContractAddress,
    pub version: u32,
    pub created_at: u64,
    pub expires_at: u64,
    pub revoked_at: u64,
    pub max_tx_value_usd_cents: u128,
    pub max_daily_spend_usd_cents: u128,
    pub execution_count: u64,
    pub total_spend_usd_cents: u128,
    pub exists: bool,
}

/// A recorded, policy-checked action. `receipt_hash` is the off-chain receipt
/// commitment and doubles as the replay-protection key.
#[derive(Drop, Serde, Copy, Debug, starknet::Store)]
pub struct ExecutionRecord {
    pub intent_hash: felt252,
    pub receipt_hash: felt252,
    pub action_hash: felt252,
    pub agent: ContractAddress,
    pub value_usd_cents: u128,
    pub recorded_at: u64,
    pub sequence: u64,
    pub exists: bool,
}

/// Result of an on-chain verification. `failure_code` is `0` on success and one
/// of `errors::Errors` otherwise, so a caller learns *which* rule failed.
#[derive(Drop, Serde, Copy, PartialEq, Debug)]
pub struct VerificationResult {
    pub verified: bool,
    pub failure_code: felt252,
}

/// Arguments for `register_intent`, grouped so the call site stays readable.
#[derive(Drop, Serde, Copy, Debug)]
pub struct RegisterIntentParams {
    pub intent_hash: felt252,
    pub version: u32,
    pub expires_at: u64,
    pub max_tx_value_usd_cents: u128,
    pub max_daily_spend_usd_cents: u128,
    pub agent: ContractAddress,
}

/// The subset of a proposed action the chain can check by itself.
#[derive(Drop, Serde, Copy, Debug)]
pub struct ActionCommitment {
    pub action_hash: felt252,
    pub value_usd_cents: u128,
}

pub fn ok() -> VerificationResult {
    VerificationResult { verified: true, failure_code: 0 }
}

pub fn failed(code: felt252) -> VerificationResult {
    VerificationResult { verified: false, failure_code: code }
}

#[generate_trait]
pub impl IntentImpl of IntentTrait {
    /// Status of this intent as of `now`. Expiry is computed, never stored, so a
    /// stale write can never make an expired intent look active.
    fn status_at(self: @Intent, now: u64) -> IntentStatus {
        if !*self.exists {
            return IntentStatus::Unknown;
        }
        if *self.revoked_at != 0 {
            return IntentStatus::Revoked;
        }
        if now >= *self.expires_at {
            return IntentStatus::Expired;
        }
        IntentStatus::Active
    }

    fn is_active_at(self: @Intent, now: u64) -> bool {
        self.status_at(now) == IntentStatus::Active
    }
}
