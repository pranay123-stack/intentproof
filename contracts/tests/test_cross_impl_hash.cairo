//! Cross-implementation hash agreement.
//!
//! The commitment is only meaningful if the TypeScript canonicalizer and this
//! contract compute the *same* felt. These vectors were produced by
//! `packages/intent-schema` (starknet.js `computePoseidonHashOnElements`) and are
//! asserted here against Cairo's `poseidon_hash_span`. The matching assertions on
//! the TypeScript side live in `packages/intent-schema/test/canonical.test.ts`, so
//! a drift in either implementation breaks a test in both repos halves.
//!
//! Canonical encoding under test:
//!   utf8(canonical_json) -> [byte_length, 31-byte big-endian chunks...]

use intentproof::policy;

/// Chunking of `{"version":1,"purpose":"portfolio_management"}` (46 bytes).
fn sample_chunks() -> Array<felt252> {
    array![
        0x2e,
        0x7b2276657273696f6e223a312c22707572706f7365223a22706f7274666f6c,
        0x696f5f6d616e6167656d656e74227d,
    ]
}

#[test]
fn poseidon_matches_starknet_js_for_a_canonical_policy() {
    assert_eq!(
        policy::compute_policy_hash(sample_chunks().span()),
        0xe128e4e67418440e69e30a75dff0d6161a9528e8dc7d7f034024368c4ba40e,
    );
}

#[test]
fn poseidon_matches_starknet_js_for_a_bare_span() {
    assert_eq!(
        policy::compute_policy_hash(array![1, 2, 3].span()),
        0x2f0d8840bcf3bc629598d8a6cc80cb7c0d9e52d93dab244bbf9cd0dca0ad082,
    );
}

#[test]
fn poseidon_matches_starknet_js_for_the_empty_string() {
    // Length-prefixing is what stops "" and a zero chunk from colliding.
    assert_eq!(
        policy::compute_policy_hash(array![0].span()),
        0x545d6f7d28a8a398e543948be5a026af60c4dea482867a6eeb2525b35d1e1e1,
    );
}

#[test]
fn the_length_prefix_separates_otherwise_identical_payloads() {
    let with_len = array![0x2, 0x4142];
    let without_len = array![0x4142];
    assert!(
        policy::compute_policy_hash(with_len.span())
            != policy::compute_policy_hash(without_len.span()),
    );
}
