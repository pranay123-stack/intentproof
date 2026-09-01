//! IntentProof — an authorization and verification layer for autonomous agents.
//!
//! The modules in this crate are deliberately split so that the *policy* logic is a
//! pure, reusable Cairo library (`policy`) that carries no storage and no access
//! control, while `intent_registry` supplies the stateful, permissioned surface.
//! Anything that can be checked without state lives in `policy` so that other
//! Starknet contracts can reuse it directly.

pub mod types;
pub mod errors;
pub mod policy;
pub mod interfaces;
pub mod intent_registry;
pub mod execution_verifier;

pub mod components {
    pub mod ownable;
}
