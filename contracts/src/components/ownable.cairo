//! Minimal two-step ownable component.
//!
//! Two-step transfer is used instead of a direct `transfer_ownership` so that a
//! typo in an address cannot permanently orphan the registry: the new owner must
//! accept before control moves.

#[starknet::interface]
pub trait IOwnable<TContractState> {
    fn owner(self: @TContractState) -> starknet::ContractAddress;
    fn pending_owner(self: @TContractState) -> starknet::ContractAddress;
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn renounce_ownership(ref self: TContractState);
}

#[starknet::component]
pub mod OwnableComponent {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use crate::errors::Errors;

    #[storage]
    pub struct Storage {
        pub owner: ContractAddress,
        pub pending_owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OwnershipTransferStarted: OwnershipTransferStarted,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferStarted {
        #[key]
        pub previous_owner: ContractAddress,
        #[key]
        pub new_owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        #[key]
        pub previous_owner: ContractAddress,
        #[key]
        pub new_owner: ContractAddress,
    }

    #[embeddable_as(OwnableImpl)]
    pub impl Ownable<
        TContractState, +HasComponent<TContractState>,
    > of super::IOwnable<ComponentState<TContractState>> {
        fn owner(self: @ComponentState<TContractState>) -> ContractAddress {
            self.owner.read()
        }

        fn pending_owner(self: @ComponentState<TContractState>) -> ContractAddress {
            self.pending_owner.read()
        }

        fn transfer_ownership(
            ref self: ComponentState<TContractState>, new_owner: ContractAddress,
        ) {
            self.assert_only_owner();
            assert(new_owner.is_non_zero(), Errors::ZERO_OWNER);
            self.pending_owner.write(new_owner);
            self
                .emit(
                    OwnershipTransferStarted {
                        previous_owner: self.owner.read(), new_owner,
                    },
                );
        }

        fn accept_ownership(ref self: ComponentState<TContractState>) {
            let caller = get_caller_address();
            assert(caller == self.pending_owner.read(), Errors::NOT_PENDING_OWNER);
            let previous = self.owner.read();
            self.owner.write(caller);
            self.pending_owner.write(Zero::zero());
            self.emit(OwnershipTransferred { previous_owner: previous, new_owner: caller });
        }

        /// Permanently drops admin control. The registry stays fully usable —
        /// only the pause switch and future upgrades become unavailable.
        fn renounce_ownership(ref self: ComponentState<TContractState>) {
            self.assert_only_owner();
            let previous = self.owner.read();
            self.owner.write(Zero::zero());
            self.pending_owner.write(Zero::zero());
            self
                .emit(
                    OwnershipTransferred {
                        previous_owner: previous, new_owner: Zero::zero(),
                    },
                );
        }
    }

    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>, owner: ContractAddress) {
            assert(owner.is_non_zero(), Errors::ZERO_OWNER);
            self.owner.write(owner);
        }

        fn assert_only_owner(self: @ComponentState<TContractState>) {
            let owner = self.owner.read();
            assert(owner.is_non_zero(), Errors::NOT_OWNER);
            assert(get_caller_address() == owner, Errors::NOT_OWNER);
        }
    }
}
