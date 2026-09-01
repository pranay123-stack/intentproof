//! The standalone verifier: recomputation plus a registry read, and nothing else.

use intentproof::interfaces::{
    IExecutionVerifierDispatcher, IExecutionVerifierDispatcherTrait, IIntentRegistryDispatcher,
    IIntentRegistryDispatcherTrait,
};
use intentproof::policy;
use intentproof::types::RegisterIntentParams;
use snforge_std::{
    start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
};
use super::common::{AGENT, DAY, T0, USER, deploy_registry, deploy_verifier};

const RECEIPT_1: felt252 = 0x5265636569707431;

fn setup() -> (IIntentRegistryDispatcher, IExecutionVerifierDispatcher, felt252) {
    let registry_address = deploy_registry();
    let verifier_address = deploy_verifier(registry_address);
    start_cheat_block_timestamp_global(T0);

    let chunks = array![0x2e, 0x11, 0x22];
    let intent_hash = policy::compute_policy_hash(chunks.span());

    let registry = IIntentRegistryDispatcher { contract_address: registry_address };
    start_cheat_caller_address(registry_address, USER);
    registry
        .register_intent(
            RegisterIntentParams {
                intent_hash,
                version: 1,
                expires_at: T0 + DAY,
                max_tx_value_usd_cents: 50_000,
                max_daily_spend_usd_cents: 100_000,
                agent: AGENT,
            },
        );
    stop_cheat_caller_address(registry_address);

    (registry, IExecutionVerifierDispatcher { contract_address: verifier_address }, intent_hash)
}

#[test]
fn verifier_points_at_the_registry_it_was_constructed_with() {
    let registry_address = deploy_registry();
    let verifier = IExecutionVerifierDispatcher {
        contract_address: deploy_verifier(registry_address),
    };
    assert_eq!(verifier.registry(), registry_address);
}

#[test]
fn commitment_check_is_stateless() {
    let (_, verifier, intent_hash) = setup();
    assert!(verifier.verify_commitment(array![0x2e, 0x11, 0x22], intent_hash));
    // A single flipped byte breaks the commitment.
    assert!(!verifier.verify_commitment(array![0x2e, 0x11, 0x23], intent_hash));
    // Reordering does too — the encoding is position-sensitive by construction.
    assert!(!verifier.verify_commitment(array![0x11, 0x2e, 0x22], intent_hash));
    assert!(!verifier.verify_commitment(array![], intent_hash));
}

#[test]
fn verify_delegates_to_the_registry() {
    let (registry, verifier, intent_hash) = setup();
    assert!(!verifier.verify(intent_hash, RECEIPT_1).verified);

    start_cheat_caller_address(registry.contract_address, AGENT);
    registry.record_execution(intent_hash, RECEIPT_1, 0xac7104, 42_000);
    stop_cheat_caller_address(registry.contract_address);

    let result = verifier.verify(intent_hash, RECEIPT_1);
    assert!(result.verified);
    assert_eq!(result.failure_code, 0);
}

#[test]
fn verify_receipt_checks_the_encoding_before_touching_the_registry() {
    let (registry, verifier, intent_hash) = setup();
    let receipt_chunks = array![0x40, 0xaa, 0xbb];
    let receipt_hash = policy::compute_policy_hash(receipt_chunks.span());

    start_cheat_caller_address(registry.contract_address, AGENT);
    registry.record_execution(intent_hash, receipt_hash, 0xac7104, 42_000);
    stop_cheat_caller_address(registry.contract_address);

    assert!(verifier.verify_receipt(intent_hash, receipt_chunks, receipt_hash).verified);

    // A receipt body that does not hash to the claimed commitment fails on the
    // encoding, before the registry is consulted at all.
    let tampered = verifier.verify_receipt(intent_hash, array![0x40, 0xaa, 0xbc], receipt_hash);
    assert!(!tampered.verified);
    assert_eq!(tampered.failure_code, 'IP: policy hash mismatch');

    let empty = verifier.verify_receipt(intent_hash, array![], receipt_hash);
    assert_eq!(empty.failure_code, 'IP: empty canonical form');
}

#[test]
fn verify_reports_an_unknown_execution_rather_than_reverting() {
    let (_, verifier, intent_hash) = setup();
    let result = verifier.verify(intent_hash, 0xdead);
    assert!(!result.verified);
    assert_eq!(result.failure_code, 'IP: unknown execution');
}
