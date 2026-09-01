//! A standalone verifier other protocols can point at.
//!
//! It holds no authorization state of its own: everything it asserts is either
//! recomputed from the canonical encoding or read back from the registry. Keeping
//! it separate means an integrator can verify IntentProof receipts without being
//! able to write to the registry.

#[starknet::contract]
pub mod ExecutionVerifier {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use crate::errors::Errors;
    use crate::interfaces::{
        IExecutionVerifier, IIntentRegistryDispatcher, IIntentRegistryDispatcherTrait,
    };
    use crate::policy;
    use crate::types::{VerificationResult, failed};

    #[storage]
    struct Storage {
        registry: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, registry: ContractAddress) {
        assert(registry.is_non_zero(), Errors::ZERO_OWNER);
        self.registry.write(registry);
    }

    #[abi(embed_v0)]
    impl ExecutionVerifierImpl of IExecutionVerifier<ContractState> {
        fn registry(self: @ContractState) -> ContractAddress {
            self.registry.read()
        }

        fn verify(
            self: @ContractState, intent_hash: felt252, receipt_hash: felt252,
        ) -> VerificationResult {
            IIntentRegistryDispatcher { contract_address: self.registry.read() }
                .verify_execution(intent_hash, receipt_hash)
        }

        fn verify_commitment(
            self: @ContractState, canonical_chunks: Array<felt252>, expected_hash: felt252,
        ) -> bool {
            if canonical_chunks.len() == 0 {
                return false;
            }
            policy::check_hash_integrity(canonical_chunks.span(), expected_hash)
        }

        fn verify_receipt(
            self: @ContractState,
            intent_hash: felt252,
            receipt_chunks: Array<felt252>,
            receipt_hash: felt252,
        ) -> VerificationResult {
            if receipt_chunks.len() == 0 {
                return failed(Errors::EMPTY_CANONICAL);
            }
            if !policy::check_hash_integrity(receipt_chunks.span(), receipt_hash) {
                return failed(Errors::HASH_MISMATCH);
            }
            IIntentRegistryDispatcher { contract_address: self.registry.read() }
                .verify_execution(intent_hash, receipt_hash)
        }
    }
}
