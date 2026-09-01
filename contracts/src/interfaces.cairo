//! Public ABIs. Kept in one module so integrators can depend on the interface
//! crate-path without pulling in the implementations.

use starknet::ContractAddress;
use crate::types::{ExecutionRecord, Intent, IntentStatus, RegisterIntentParams, VerificationResult};

#[starknet::interface]
pub trait IIntentRegistry<TContractState> {
    // --- write ---

    /// Commit an approved policy. `params.intent_hash` is trusted as given; use
    /// `register_intent_from_canonical` when the caller wants the chain itself to
    /// recompute the commitment from the canonical encoding.
    fn register_intent(ref self: TContractState, params: RegisterIntentParams) -> u64;

    /// Commit an approved policy *and* verify the commitment on-chain by
    /// re-hashing the canonical encoding. Reverts on mismatch.
    fn register_intent_from_canonical(
        ref self: TContractState, canonical_chunks: Array<felt252>, params: RegisterIntentParams,
    ) -> u64;

    fn revoke_intent(ref self: TContractState, intent_hash: felt252);

    fn authorize_agent(
        ref self: TContractState, intent_hash: felt252, agent: ContractAddress, authorized: bool,
    );

    /// Record a policy-checked execution. Re-runs every check the chain can make
    /// before writing, so a compromised agent cannot record an action the policy
    /// forbids even if the off-chain engine was bypassed.
    fn record_execution(
        ref self: TContractState,
        intent_hash: felt252,
        receipt_hash: felt252,
        action_hash: felt252,
        value_usd_cents: u128,
    ) -> u64;

    /// Verify and emit `ExecutionVerified`. Same logic as `verify_execution`,
    /// but leaves an on-chain trace that a verification took place.
    fn attest_execution(
        ref self: TContractState, intent_hash: felt252, receipt_hash: felt252,
    ) -> VerificationResult;

    fn set_paused(ref self: TContractState, paused: bool);

    // --- read ---

    fn get_intent(self: @TContractState, intent_hash: felt252) -> Intent;
    fn get_intent_by_id(self: @TContractState, intent_id: u64) -> Intent;
    fn get_intent_hash_by_id(self: @TContractState, intent_id: u64) -> felt252;
    fn is_intent_active(self: @TContractState, intent_hash: felt252) -> bool;
    fn get_intent_status(self: @TContractState, intent_hash: felt252) -> IntentStatus;
    fn get_execution(
        self: @TContractState, intent_hash: felt252, receipt_hash: felt252,
    ) -> ExecutionRecord;
    fn get_execution_by_index(
        self: @TContractState, intent_hash: felt252, index: u64,
    ) -> ExecutionRecord;
    fn verify_execution(
        self: @TContractState, intent_hash: felt252, receipt_hash: felt252,
    ) -> VerificationResult;
    fn intent_count(self: @TContractState) -> u64;
    fn execution_count(self: @TContractState, intent_hash: felt252) -> u64;
    fn daily_spend(self: @TContractState, intent_hash: felt252, day: u64) -> u128;
    fn is_agent_authorized(
        self: @TContractState, intent_hash: felt252, agent: ContractAddress,
    ) -> bool;
    fn is_paused(self: @TContractState) -> bool;

    /// Recompute a policy commitment from its canonical encoding. Pure; exposed
    /// so any client can check its own canonicalizer against the chain's.
    fn compute_policy_hash(self: @TContractState, canonical_chunks: Array<felt252>) -> felt252;
}

#[starknet::interface]
pub trait IExecutionVerifier<TContractState> {
    fn registry(self: @TContractState) -> ContractAddress;

    /// Full check: the receipt must be recorded under an intent that was active,
    /// unrevoked and unexpired at the time it was recorded.
    fn verify(
        self: @TContractState, intent_hash: felt252, receipt_hash: felt252,
    ) -> VerificationResult;

    /// Check a canonical encoding against a claimed commitment without touching
    /// the registry. Stateless, so anyone can reproduce it offline.
    fn verify_commitment(
        self: @TContractState, canonical_chunks: Array<felt252>, expected_hash: felt252,
    ) -> bool;

    /// Verify that a receipt's canonical encoding hashes to `receipt_hash` *and*
    /// that the receipt is bound to `intent_hash`, then check it on the registry.
    fn verify_receipt(
        self: @TContractState,
        intent_hash: felt252,
        receipt_chunks: Array<felt252>,
        receipt_hash: felt252,
    ) -> VerificationResult;
}
