//! Registry behaviour: registration, revocation, agent authorization, execution
//! recording and the on-chain limit enforcement.

use intentproof::interfaces::{IIntentRegistryDispatcher, IIntentRegistryDispatcherTrait};
use intentproof::intent_registry::IntentRegistry;
use intentproof::components::ownable::{IOwnableDispatcher, IOwnableDispatcherTrait};
use intentproof::policy;
use intentproof::types::{IntentStatus, RegisterIntentParams};
use snforge_std::{
    EventSpyAssertionsTrait, spy_events, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use super::common::{AGENT, DAY, OTHER, OWNER, ROGUE_AGENT, T0, USER, deploy_registry};

const HASH_A: felt252 = 0x0a11ce;
const HASH_B: felt252 = 0x0b0b;
const RECEIPT_1: felt252 = 0x5265636569707431;

fn params(intent_hash: felt252, agent: ContractAddress) -> RegisterIntentParams {
    RegisterIntentParams {
        intent_hash,
        version: 1,
        expires_at: T0 + DAY,
        max_tx_value_usd_cents: 50_000, // $500
        max_daily_spend_usd_cents: 100_000, // $1000
        agent,
    }
}

fn setup() -> (IIntentRegistryDispatcher, ContractAddress) {
    let address = deploy_registry();
    start_cheat_block_timestamp_global(T0);
    (IIntentRegistryDispatcher { contract_address: address }, address)
}

fn register_as_user(registry: IIntentRegistryDispatcher, address: ContractAddress) -> u64 {
    start_cheat_caller_address(address, USER);
    let id = registry.register_intent(params(HASH_A, AGENT));
    stop_cheat_caller_address(address);
    id
}

#[test]
fn register_stores_the_commitment_and_assigns_sequential_ids() {
    let (registry, address) = setup();

    start_cheat_caller_address(address, USER);
    let id_a = registry.register_intent(params(HASH_A, AGENT));
    let id_b = registry.register_intent(params(HASH_B, AGENT));
    stop_cheat_caller_address(address);

    assert_eq!(id_a, 0);
    assert_eq!(id_b, 1);
    assert_eq!(registry.intent_count(), 2);

    let intent = registry.get_intent(HASH_A);
    assert!(intent.exists);
    assert_eq!(intent.intent_hash, HASH_A);
    assert_eq!(intent.creator, USER);
    assert_eq!(intent.created_at, T0);
    assert_eq!(intent.expires_at, T0 + DAY);
    assert_eq!(intent.revoked_at, 0);
    assert_eq!(intent.execution_count, 0);
    assert_eq!(registry.get_intent_hash_by_id(1), HASH_B);
    assert_eq!(registry.get_intent_by_id(0).intent_hash, HASH_A);
    assert!(registry.is_intent_active(HASH_A));
    assert_eq!(registry.get_intent_status(HASH_A), IntentStatus::Active);
    // Registering names the agent in one step.
    assert!(registry.is_agent_authorized(HASH_A, AGENT));
    assert!(!registry.is_agent_authorized(HASH_A, ROGUE_AGENT));
}

#[test]
fn register_emits_intent_created() {
    let (registry, address) = setup();
    let mut spy = spy_events();

    start_cheat_caller_address(address, USER);
    registry.register_intent(params(HASH_A, AGENT));
    stop_cheat_caller_address(address);

    spy
        .assert_emitted(
            @array![
                (
                    address,
                    IntentRegistry::Event::IntentCreated(
                        IntentRegistry::IntentCreated {
                            intent_hash: HASH_A,
                            creator: USER,
                            intent_id: 0,
                            version: 1,
                            created_at: T0,
                            expires_at: T0 + DAY,
                            max_tx_value_usd_cents: 50_000,
                            max_daily_spend_usd_cents: 100_000,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: 'IP: intent exists')]
fn duplicate_commitments_are_rejected() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    registry.register_intent(params(HASH_A, AGENT));
    registry.register_intent(params(HASH_A, AGENT));
}

#[test]
#[should_panic(expected: 'IP: expiry in the past')]
fn expiry_must_be_in_the_future() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    let mut p = params(HASH_A, AGENT);
    p.expires_at = T0;
    registry.register_intent(p);
}

#[test]
#[should_panic(expected: 'IP: zero intent hash')]
fn zero_commitment_is_rejected() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    registry.register_intent(params(0, AGENT));
}

#[test]
#[should_panic(expected: 'IP: version must be non-zero')]
fn version_zero_is_rejected() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    let mut p = params(HASH_A, AGENT);
    p.version = 0;
    registry.register_intent(p);
}

// --- on-chain recomputation of the commitment ---

#[test]
fn register_from_canonical_recomputes_the_hash_on_chain() {
    let (registry, address) = setup();
    let chunks = array![0x494e54454e54, 0x504f4c494359, 0x5631];
    let expected = policy::compute_policy_hash(chunks.span());
    assert_eq!(registry.compute_policy_hash(chunks.clone()), expected);

    start_cheat_caller_address(address, USER);
    let id = registry.register_intent_from_canonical(chunks, params(expected, AGENT));
    stop_cheat_caller_address(address);

    assert_eq!(id, 0);
    assert_eq!(registry.get_intent(expected).intent_hash, expected);
}

#[test]
#[should_panic(expected: 'IP: policy hash mismatch')]
fn register_from_canonical_rejects_a_mismatched_commitment() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    registry
        .register_intent_from_canonical(array![1, 2, 3], params(0xdeadbeef, AGENT));
}

#[test]
#[should_panic(expected: 'IP: empty canonical form')]
fn register_from_canonical_rejects_an_empty_encoding() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    registry.register_intent_from_canonical(array![], params(HASH_A, AGENT));
}

// --- revocation ---

#[test]
fn creator_can_revoke() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    let mut spy = spy_events();

    start_cheat_block_timestamp_global(T0 + 100);
    start_cheat_caller_address(address, USER);
    registry.revoke_intent(HASH_A);
    stop_cheat_caller_address(address);

    assert!(!registry.is_intent_active(HASH_A));
    assert_eq!(registry.get_intent_status(HASH_A), IntentStatus::Revoked);
    assert_eq!(registry.get_intent(HASH_A).revoked_at, T0 + 100);
    spy
        .assert_emitted(
            @array![
                (
                    address,
                    IntentRegistry::Event::IntentRevoked(
                        IntentRegistry::IntentRevoked {
                            intent_hash: HASH_A, revoked_by: USER, revoked_at: T0 + 100,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: 'IP: not intent creator')]
fn a_stranger_cannot_revoke() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, OTHER);
    registry.revoke_intent(HASH_A);
}

#[test]
#[should_panic(expected: 'IP: not intent creator')]
fn the_registry_owner_cannot_revoke_a_users_intent() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    // Admin power stops at pausing; it never extends to another account's intents.
    start_cheat_caller_address(address, OWNER);
    registry.revoke_intent(HASH_A);
}

#[test]
#[should_panic(expected: 'IP: already revoked')]
fn double_revocation_is_rejected() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, USER);
    registry.revoke_intent(HASH_A);
    registry.revoke_intent(HASH_A);
}

#[test]
#[should_panic(expected: 'IP: unknown intent')]
fn revoking_an_unknown_intent_is_rejected() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    registry.revoke_intent(0x6e6f7065);
}

#[test]
fn expiry_needs_no_transaction() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    assert!(registry.is_intent_active(HASH_A));

    start_cheat_block_timestamp_global(T0 + DAY);
    assert!(!registry.is_intent_active(HASH_A));
    assert_eq!(registry.get_intent_status(HASH_A), IntentStatus::Expired);
}

// --- agent authorization ---

#[test]
fn creator_controls_the_agent_allowlist() {
    let (registry, address) = setup();
    register_as_user(registry, address);

    start_cheat_caller_address(address, USER);
    registry.authorize_agent(HASH_A, ROGUE_AGENT, true);
    assert!(registry.is_agent_authorized(HASH_A, ROGUE_AGENT));
    registry.authorize_agent(HASH_A, ROGUE_AGENT, false);
    assert!(!registry.is_agent_authorized(HASH_A, ROGUE_AGENT));
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'IP: not intent creator')]
fn an_agent_cannot_authorize_itself() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, ROGUE_AGENT);
    registry.authorize_agent(HASH_A, ROGUE_AGENT, true);
}

// --- execution recording ---

#[test]
fn authorized_agent_can_record_an_in_policy_execution() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    let mut spy = spy_events();

    start_cheat_caller_address(address, AGENT);
    let seq = registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 42_000);
    stop_cheat_caller_address(address);

    assert_eq!(seq, 0);
    let record = registry.get_execution(HASH_A, RECEIPT_1);
    assert!(record.exists);
    assert_eq!(record.agent, AGENT);
    assert_eq!(record.value_usd_cents, 42_000);
    assert_eq!(record.recorded_at, T0);
    assert_eq!(registry.execution_count(HASH_A), 1);
    assert_eq!(registry.daily_spend(HASH_A, policy::day_index(T0)), 42_000);
    assert_eq!(registry.get_execution_by_index(HASH_A, 0).receipt_hash, RECEIPT_1);
    assert_eq!(registry.get_intent(HASH_A).total_spend_usd_cents, 42_000);

    spy
        .assert_emitted(
            @array![
                (
                    address,
                    IntentRegistry::Event::ExecutionRecorded(
                        IntentRegistry::ExecutionRecorded {
                            intent_hash: HASH_A,
                            receipt_hash: RECEIPT_1,
                            agent: AGENT,
                            action_hash: 0xac7104,
                            value_usd_cents: 42_000,
                            sequence: 0,
                            recorded_at: T0,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: 'IP: agent not authorized')]
fn an_unauthorized_agent_cannot_record() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, ROGUE_AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 1_000);
}

#[test]
#[should_panic(expected: 'IP: tx value over limit')]
fn the_chain_enforces_the_per_transaction_limit() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    // $500.01 against a $500 cap — rejected on-chain even though the
    // off-chain engine is what normally catches this first.
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 50_001);
}

#[test]
#[should_panic(expected: 'IP: daily spend over limit')]
fn the_chain_enforces_the_daily_limit() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, 0x1, 0xa, 50_000);
    registry.record_execution(HASH_A, 0x2, 0xb, 50_000);
    // 1000.01 of a $1000 daily cap.
    registry.record_execution(HASH_A, 0x3, 0xc, 1);
}

#[test]
fn the_daily_limit_resets_on_the_next_utc_day() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, USER);
    let mut p = params(HASH_A, AGENT);
    p.expires_at = T0 + 10 * DAY;
    registry.register_intent(p);
    stop_cheat_caller_address(address);

    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, 0x1, 0xa, 50_000);
    registry.record_execution(HASH_A, 0x2, 0xb, 50_000);

    start_cheat_block_timestamp_global(T0 + DAY);
    let seq = registry.record_execution(HASH_A, 0x3, 0xc, 50_000);
    stop_cheat_caller_address(address);

    assert_eq!(seq, 2);
    assert_eq!(registry.daily_spend(HASH_A, policy::day_index(T0)), 100_000);
    assert_eq!(registry.daily_spend(HASH_A, policy::day_index(T0 + DAY)), 50_000);
}

#[test]
#[should_panic(expected: 'IP: receipt already recorded')]
fn replaying_a_receipt_is_rejected() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 10_000);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 10_000);
}

#[test]
#[should_panic(expected: 'IP: intent revoked')]
fn a_revoked_intent_cannot_be_executed_against() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, USER);
    registry.revoke_intent(HASH_A);
    stop_cheat_caller_address(address);

    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 1_000);
}

#[test]
#[should_panic(expected: 'IP: intent expired')]
fn an_expired_intent_cannot_be_executed_against() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_block_timestamp_global(T0 + DAY);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 1_000);
}

#[test]
#[should_panic(expected: 'IP: unknown intent')]
fn recording_against_an_unknown_intent_is_rejected() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(0x67686f7374, RECEIPT_1, 0xac7104, 1_000);
}

#[test]
#[should_panic(expected: 'IP: zero receipt hash')]
fn a_zero_receipt_hash_is_rejected() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, 0, 0xac7104, 1_000);
}

// --- verification ---

#[test]
fn verify_execution_confirms_a_recorded_action() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 42_000);
    stop_cheat_caller_address(address);

    let result = registry.verify_execution(HASH_A, RECEIPT_1);
    assert!(result.verified);
    assert_eq!(result.failure_code, 0);
}

#[test]
fn verification_survives_later_expiry_but_not_earlier_revocation() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 42_000);
    stop_cheat_caller_address(address);

    // The authorization has since lapsed, but the action was in-policy when taken.
    start_cheat_block_timestamp_global(T0 + 10 * DAY);
    assert!(registry.verify_execution(HASH_A, RECEIPT_1).verified);

    // A revocation that predates the receipt would be a different story; here the
    // revocation comes after, so the historical receipt still verifies.
    start_cheat_caller_address(address, USER);
    registry.revoke_intent(HASH_A);
    stop_cheat_caller_address(address);
    assert!(registry.verify_execution(HASH_A, RECEIPT_1).verified);
}

#[test]
fn verification_reports_which_rule_failed() {
    let (registry, address) = setup();
    assert_eq!(registry.verify_execution(HASH_A, RECEIPT_1).failure_code, 'IP: unknown intent');

    register_as_user(registry, address);
    assert_eq!(
        registry.verify_execution(HASH_A, RECEIPT_1).failure_code, 'IP: unknown execution',
    );
}

#[test]
fn deauthorizing_an_agent_invalidates_its_past_receipts() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 42_000);
    stop_cheat_caller_address(address);
    assert!(registry.verify_execution(HASH_A, RECEIPT_1).verified);

    // Withdrawing an agent's authority is retroactive on purpose: if the user
    // decides the agent was never theirs, its receipts stop counting as proof.
    start_cheat_caller_address(address, USER);
    registry.authorize_agent(HASH_A, AGENT, false);
    stop_cheat_caller_address(address);

    let result = registry.verify_execution(HASH_A, RECEIPT_1);
    assert!(!result.verified);
    assert_eq!(result.failure_code, 'IP: agent not authorized');
}

#[test]
fn attest_execution_emits_the_verification() {
    let (registry, address) = setup();
    register_as_user(registry, address);
    start_cheat_caller_address(address, AGENT);
    registry.record_execution(HASH_A, RECEIPT_1, 0xac7104, 42_000);
    stop_cheat_caller_address(address);

    let mut spy = spy_events();
    start_cheat_caller_address(address, OTHER);
    let result = registry.attest_execution(HASH_A, RECEIPT_1);
    stop_cheat_caller_address(address);

    assert!(result.verified);
    spy
        .assert_emitted(
            @array![
                (
                    address,
                    IntentRegistry::Event::ExecutionVerified(
                        IntentRegistry::ExecutionVerified {
                            intent_hash: HASH_A,
                            receipt_hash: RECEIPT_1,
                            verifier: OTHER,
                            verified: true,
                            failure_code: 0,
                        },
                    ),
                ),
            ],
        );
}

// --- admin surface ---

#[test]
fn owner_can_pause_new_writes() {
    let (registry, address) = setup();
    register_as_user(registry, address);

    start_cheat_caller_address(address, OWNER);
    registry.set_paused(true);
    stop_cheat_caller_address(address);
    assert!(registry.is_paused());

    // Reads keep working while paused.
    assert!(registry.is_intent_active(HASH_A));
    assert_eq!(registry.get_intent(HASH_A).creator, USER);
}

#[test]
#[should_panic(expected: 'IP: registry paused')]
fn pausing_stops_registration() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, OWNER);
    registry.set_paused(true);
    stop_cheat_caller_address(address);

    start_cheat_caller_address(address, USER);
    registry.register_intent(params(HASH_A, AGENT));
}

#[test]
#[should_panic(expected: 'IP: caller is not the owner')]
fn a_stranger_cannot_pause() {
    let (registry, address) = setup();
    start_cheat_caller_address(address, OTHER);
    registry.set_paused(true);
}

#[test]
fn ownership_transfer_is_two_step() {
    let (_, address) = setup();
    let ownable = IOwnableDispatcher { contract_address: address };
    assert_eq!(ownable.owner(), OWNER);

    start_cheat_caller_address(address, OWNER);
    ownable.transfer_ownership(OTHER);
    stop_cheat_caller_address(address);

    // Not yet: a mistyped address cannot orphan the contract.
    assert_eq!(ownable.owner(), OWNER);
    assert_eq!(ownable.pending_owner(), OTHER);

    start_cheat_caller_address(address, OTHER);
    ownable.accept_ownership();
    stop_cheat_caller_address(address);
    assert_eq!(ownable.owner(), OTHER);
}

#[test]
#[should_panic(expected: 'IP: not the pending owner')]
fn only_the_pending_owner_can_accept() {
    let (_, address) = setup();
    let ownable = IOwnableDispatcher { contract_address: address };
    start_cheat_caller_address(address, OWNER);
    ownable.transfer_ownership(OTHER);
    stop_cheat_caller_address(address);

    start_cheat_caller_address(address, USER);
    ownable.accept_ownership();
}
