use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::ContractAddress;

pub const OWNER: ContractAddress = 0x0100.try_into().unwrap();
pub const USER: ContractAddress = 0x0201.try_into().unwrap();
pub const OTHER: ContractAddress = 0x0202.try_into().unwrap();
pub const AGENT: ContractAddress = 0x0301.try_into().unwrap();
pub const ROGUE_AGENT: ContractAddress = 0x0302.try_into().unwrap();

/// Nothing in the suite depends on wall-clock time; every test pins the clock.
pub const T0: u64 = 1_800_000_000;
pub const DAY: u64 = 86400;

pub fn deploy_registry() -> ContractAddress {
    let contract = declare("IntentRegistry").unwrap().contract_class();
    let mut calldata = array![];
    OWNER.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

pub fn deploy_verifier(registry: ContractAddress) -> ContractAddress {
    let contract = declare("ExecutionVerifier").unwrap().contract_class();
    let mut calldata = array![];
    registry.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}
