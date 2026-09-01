//! Unit tests for the pure policy library. No contracts are deployed here — these
//! are the checks any Starknet contract reusing `intentproof::policy` inherits.

use intentproof::errors::Errors;
use intentproof::policy;
use intentproof::types::{Intent, IntentStatus, IntentTrait};

fn bounds(max_tx: u128, max_daily: u128, expires_at: u64) -> policy::PolicyBounds {
    policy::PolicyBounds {
        max_tx_value_usd_cents: max_tx,
        max_daily_spend_usd_cents: max_daily,
        max_slippage_bps: 100,
        expires_at,
    }
}

#[test]
fn allowlist_membership() {
    let allowed = array!['swap', 'transfer'].span();
    assert!(policy::check_action_allowed('swap', allowed));
    assert!(!policy::check_action_allowed('borrow', allowed));
    assert!(!policy::check_action_allowed('swap', array![].span()));
}

#[test]
fn forbidden_actions_take_precedence() {
    let forbidden = array!['borrow', 'leverage'].span();
    assert!(policy::check_not_forbidden('swap', forbidden));
    assert!(!policy::check_not_forbidden('borrow', forbidden));
    // An action named in both lists must still be refused.
    assert!(policy::check_action_allowed('borrow', array!['borrow'].span()));
    assert!(!policy::check_not_forbidden('borrow', forbidden));
}

#[test]
fn asset_and_contract_allowlists() {
    let assets = array!['ETH', 'STRK'].span();
    assert!(policy::check_asset_allowed('ETH', assets));
    assert!(!policy::check_asset_allowed('DOGE', assets));

    let contracts = array!['DEX_A', 'DEX_B'].span();
    assert!(policy::check_contract_allowed('DEX_A', contracts));
    assert!(!policy::check_contract_allowed('UNKNOWN', contracts));
}

#[test]
fn transaction_limit_is_inclusive() {
    assert!(policy::check_transaction_value(50_000, 50_000));
    assert!(!policy::check_transaction_value(50_001, 50_000));
}

#[test]
fn daily_limit_accumulates() {
    // 40_000 spent of a 100_000 cap leaves exactly 60_000.
    assert!(policy::check_daily_spend(40_000, 60_000, 100_000));
    assert!(!policy::check_daily_spend(40_000, 60_001, 100_000));
    // An already-over-cap day rejects even a zero-value action.
    assert!(!policy::check_daily_spend(100_001, 0, 100_000));
}

#[test]
fn daily_limit_cannot_wrap() {
    // Written as a subtraction precisely so a huge value cannot overflow into a pass.
    let huge: u128 = 0xffffffffffffffffffffffffffffffff;
    assert!(!policy::check_daily_spend(1, huge, 100_000));
}

#[test]
fn slippage_bound() {
    assert!(policy::check_slippage(60, 100));
    assert!(policy::check_slippage(100, 100));
    assert!(!policy::check_slippage(101, 100));
}

#[test]
fn expiry_is_exclusive_at_the_boundary() {
    assert!(policy::check_not_expired(1_000, 999));
    assert!(!policy::check_not_expired(1_000, 1_000));
    assert!(!policy::check_not_expired(1_000, 1_001));
}

#[test]
fn revocation_and_replay() {
    assert!(policy::check_not_revoked(0));
    assert!(!policy::check_not_revoked(1));
    assert!(policy::check_no_replay(false));
    assert!(!policy::check_no_replay(true));
}

#[test]
fn day_index_buckets_by_utc_day() {
    assert_eq!(policy::day_index(0), 0);
    assert_eq!(policy::day_index(86_399), 0);
    assert_eq!(policy::day_index(86_400), 1);
    assert_eq!(policy::day_index(172_800), 2);
}

#[test]
fn hash_integrity_detects_mutation() {
    let chunks = array![11, 22, 33];
    let h = policy::compute_policy_hash(chunks.span());
    assert!(policy::check_hash_integrity(chunks.span(), h));
    // Reordering the same values must not reproduce the commitment.
    assert!(!policy::check_hash_integrity(array![22, 11, 33].span(), h));
    assert!(!policy::check_hash_integrity(array![11, 22, 34].span(), h));
}

#[test]
fn evaluate_reports_the_first_failing_rule() {
    let b = bounds(50_000, 100_000, 2_000);

    let good = policy::evaluate(b, 0, 1_000, false, 0, 42_000);
    assert!(good.verified);
    assert_eq!(good.failure_code, 0);

    assert_eq!(policy::evaluate(b, 999, 1_000, false, 0, 1).failure_code, Errors::REVOKED);
    assert_eq!(policy::evaluate(b, 0, 2_000, false, 0, 1).failure_code, Errors::EXPIRED);
    assert_eq!(policy::evaluate(b, 0, 1_000, true, 0, 1).failure_code, Errors::REPLAY);
    assert_eq!(policy::evaluate(b, 0, 1_000, false, 0, 50_001).failure_code, Errors::TX_LIMIT);
    assert_eq!(
        policy::evaluate(b, 0, 1_000, false, 90_000, 20_000).failure_code, Errors::DAILY_LIMIT,
    );
}

fn sample_intent(expires_at: u64, revoked_at: u64, exists: bool) -> Intent {
    Intent {
        id: 0,
        intent_hash: 0x1234,
        creator: 0x1.try_into().unwrap(),
        version: 1,
        created_at: 100,
        expires_at,
        revoked_at,
        max_tx_value_usd_cents: 50_000,
        max_daily_spend_usd_cents: 100_000,
        execution_count: 0,
        total_spend_usd_cents: 0,
        exists,
    }
}

#[test]
fn intent_status_is_derived_not_stored() {
    let live = sample_intent(1_000, 0, true);
    assert_eq!(live.status_at(500), IntentStatus::Active);
    // Same stored struct, later clock: expiry needs no write.
    assert_eq!(live.status_at(1_000), IntentStatus::Expired);

    let revoked = sample_intent(1_000, 400, true);
    assert_eq!(revoked.status_at(500), IntentStatus::Revoked);
    // Revocation outranks expiry in the reported status.
    assert_eq!(revoked.status_at(5_000), IntentStatus::Revoked);

    assert_eq!(sample_intent(1_000, 0, false).status_at(500), IntentStatus::Unknown);
}
