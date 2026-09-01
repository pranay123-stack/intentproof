//! The IntentRegistry: on-chain commitments for human-approved agent policies.
//!
//! Trust model, stated plainly:
//!
//! * The registry never sees the policy text. It stores a Poseidon commitment to
//!   the canonical encoding, so any later change to the policy is detectable.
//! * The registry *does* store the numeric limits, expiry and agent allowlist, so
//!   `record_execution` is an independent enforcement point rather than a log.
//!   An agent that bypasses the off-chain engine still cannot record an
//!   over-limit, expired, revoked or replayed action.
//! * Only the intent's creator can revoke it or change its agent allowlist. The
//!   contract owner can pause new writes but can neither forge nor alter an
//!   intent, and cannot revoke on a user's behalf.

#[starknet::contract]
pub mod IntentRegistry {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess, StoragePathEntry,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use crate::components::ownable::OwnableComponent;
    use crate::errors::Errors;
    use crate::interfaces::IIntentRegistry;
    use crate::policy;
    use crate::types::{
        ExecutionRecord, Intent, IntentStatus, IntentTrait, RegisterIntentParams,
        VerificationResult, failed, ok,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        intents: Map<felt252, Intent>,
        intent_hash_by_id: Map<u64, felt252>,
        intent_count: u64,
        /// (intent_hash, receipt_hash) -> record. Presence is replay protection.
        executions: Map<(felt252, felt252), ExecutionRecord>,
        /// (intent_hash, sequence) -> receipt_hash, for enumeration.
        execution_index: Map<(felt252, u64), felt252>,
        /// (intent_hash, day_index) -> cents spent that UTC day.
        daily_spend: Map<(felt252, u64), u128>,
        /// (intent_hash, agent) -> may record executions against this intent.
        agent_authorized: Map<(felt252, ContractAddress), bool>,
        paused: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        IntentCreated: IntentCreated,
        IntentRevoked: IntentRevoked,
        AgentAuthorizationChanged: AgentAuthorizationChanged,
        ExecutionRecorded: ExecutionRecorded,
        ExecutionVerified: ExecutionVerified,
        PausedSet: PausedSet,
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IntentCreated {
        #[key]
        pub intent_hash: felt252,
        #[key]
        pub creator: ContractAddress,
        pub intent_id: u64,
        pub version: u32,
        pub created_at: u64,
        pub expires_at: u64,
        pub max_tx_value_usd_cents: u128,
        pub max_daily_spend_usd_cents: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IntentRevoked {
        #[key]
        pub intent_hash: felt252,
        #[key]
        pub revoked_by: ContractAddress,
        pub revoked_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentAuthorizationChanged {
        #[key]
        pub intent_hash: felt252,
        #[key]
        pub agent: ContractAddress,
        pub authorized: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExecutionRecorded {
        #[key]
        pub intent_hash: felt252,
        #[key]
        pub receipt_hash: felt252,
        #[key]
        pub agent: ContractAddress,
        pub action_hash: felt252,
        pub value_usd_cents: u128,
        pub sequence: u64,
        pub recorded_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExecutionVerified {
        #[key]
        pub intent_hash: felt252,
        #[key]
        pub receipt_hash: felt252,
        #[key]
        pub verifier: ContractAddress,
        pub verified: bool,
        pub failure_code: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PausedSet {
        pub paused: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl IntentRegistryImpl of IIntentRegistry<ContractState> {
        fn register_intent(ref self: ContractState, params: RegisterIntentParams) -> u64 {
            self.register(params)
        }

        fn register_intent_from_canonical(
            ref self: ContractState,
            canonical_chunks: Array<felt252>,
            params: RegisterIntentParams,
        ) -> u64 {
            assert(canonical_chunks.len() != 0, Errors::EMPTY_CANONICAL);
            let recomputed = policy::compute_policy_hash(canonical_chunks.span());
            assert(recomputed == params.intent_hash, Errors::HASH_MISMATCH);
            self.register(params)
        }

        fn revoke_intent(ref self: ContractState, intent_hash: felt252) {
            let mut intent = self.intents.entry(intent_hash).read();
            assert(intent.exists, Errors::INTENT_UNKNOWN);
            assert(get_caller_address() == intent.creator, Errors::NOT_CREATOR);
            assert(intent.revoked_at == 0, Errors::ALREADY_REVOKED);

            let now = get_block_timestamp();
            intent.revoked_at = now;
            self.intents.entry(intent_hash).write(intent);
            self
                .emit(
                    IntentRevoked {
                        intent_hash, revoked_by: get_caller_address(), revoked_at: now,
                    },
                );
        }

        fn authorize_agent(
            ref self: ContractState,
            intent_hash: felt252,
            agent: ContractAddress,
            authorized: bool,
        ) {
            let intent = self.intents.entry(intent_hash).read();
            assert(intent.exists, Errors::INTENT_UNKNOWN);
            assert(get_caller_address() == intent.creator, Errors::NOT_CREATOR);
            self.agent_authorized.entry((intent_hash, agent)).write(authorized);
            self.emit(AgentAuthorizationChanged { intent_hash, agent, authorized });
        }

        fn record_execution(
            ref self: ContractState,
            intent_hash: felt252,
            receipt_hash: felt252,
            action_hash: felt252,
            value_usd_cents: u128,
        ) -> u64 {
            assert(!self.paused.read(), Errors::PAUSED);
            assert(receipt_hash != 0, Errors::ZERO_RECEIPT);

            let mut intent = self.intents.entry(intent_hash).read();
            assert(intent.exists, Errors::INTENT_UNKNOWN);

            let agent = get_caller_address();
            assert(
                self.agent_authorized.entry((intent_hash, agent)).read(),
                Errors::NOT_AUTHORIZED_AGENT,
            );

            let now = get_block_timestamp();
            let day = policy::day_index(now);
            let spent_today = self.daily_spend.entry((intent_hash, day)).read();
            let already = self.executions.entry((intent_hash, receipt_hash)).read().exists;

            let bounds = policy::PolicyBounds {
                max_tx_value_usd_cents: intent.max_tx_value_usd_cents,
                max_daily_spend_usd_cents: intent.max_daily_spend_usd_cents,
                max_slippage_bps: 0,
                expires_at: intent.expires_at,
            };
            let verdict = policy::evaluate(
                bounds, intent.revoked_at, now, already, spent_today, value_usd_cents,
            );
            // Not a soft failure: an unauthorized action must not reach storage.
            assert(verdict.verified, verdict.failure_code);

            let sequence = intent.execution_count;
            let record = ExecutionRecord {
                intent_hash,
                receipt_hash,
                action_hash,
                agent,
                value_usd_cents,
                recorded_at: now,
                sequence,
                exists: true,
            };
            self.executions.entry((intent_hash, receipt_hash)).write(record);
            self.execution_index.entry((intent_hash, sequence)).write(receipt_hash);
            self.daily_spend.entry((intent_hash, day)).write(spent_today + value_usd_cents);

            intent.execution_count = sequence + 1;
            intent.total_spend_usd_cents += value_usd_cents;
            self.intents.entry(intent_hash).write(intent);

            self
                .emit(
                    ExecutionRecorded {
                        intent_hash,
                        receipt_hash,
                        agent,
                        action_hash,
                        value_usd_cents,
                        sequence,
                        recorded_at: now,
                    },
                );
            sequence
        }

        fn attest_execution(
            ref self: ContractState, intent_hash: felt252, receipt_hash: felt252,
        ) -> VerificationResult {
            let result = self.verify_execution(intent_hash, receipt_hash);
            self
                .emit(
                    ExecutionVerified {
                        intent_hash,
                        receipt_hash,
                        verifier: get_caller_address(),
                        verified: result.verified,
                        failure_code: result.failure_code,
                    },
                );
            result
        }

        fn set_paused(ref self: ContractState, paused: bool) {
            self.ownable.assert_only_owner();
            self.paused.write(paused);
            self.emit(PausedSet { paused });
        }

        fn get_intent(self: @ContractState, intent_hash: felt252) -> Intent {
            self.intents.entry(intent_hash).read()
        }

        fn get_intent_by_id(self: @ContractState, intent_id: u64) -> Intent {
            let hash = self.intent_hash_by_id.entry(intent_id).read();
            self.intents.entry(hash).read()
        }

        fn get_intent_hash_by_id(self: @ContractState, intent_id: u64) -> felt252 {
            self.intent_hash_by_id.entry(intent_id).read()
        }

        fn is_intent_active(self: @ContractState, intent_hash: felt252) -> bool {
            self.intents.entry(intent_hash).read().is_active_at(get_block_timestamp())
        }

        fn get_intent_status(self: @ContractState, intent_hash: felt252) -> IntentStatus {
            self.intents.entry(intent_hash).read().status_at(get_block_timestamp())
        }

        fn get_execution(
            self: @ContractState, intent_hash: felt252, receipt_hash: felt252,
        ) -> ExecutionRecord {
            self.executions.entry((intent_hash, receipt_hash)).read()
        }

        fn get_execution_by_index(
            self: @ContractState, intent_hash: felt252, index: u64,
        ) -> ExecutionRecord {
            let receipt_hash = self.execution_index.entry((intent_hash, index)).read();
            self.executions.entry((intent_hash, receipt_hash)).read()
        }

        /// Verification is deliberately time-independent for the *recording*
        /// question and time-dependent for the *authority* question: a receipt
        /// recorded while the intent was live stays verified after expiry, but an
        /// intent that was revoked before the receipt was recorded never verifies.
        fn verify_execution(
            self: @ContractState, intent_hash: felt252, receipt_hash: felt252,
        ) -> VerificationResult {
            let intent = self.intents.entry(intent_hash).read();
            if !intent.exists {
                return failed(Errors::INTENT_UNKNOWN);
            }
            let record = self.executions.entry((intent_hash, receipt_hash)).read();
            if !record.exists {
                return failed(Errors::UNKNOWN_EXECUTION);
            }
            if record.intent_hash != intent_hash {
                return failed(Errors::HASH_MISMATCH);
            }
            if intent.revoked_at != 0 && record.recorded_at >= intent.revoked_at {
                return failed(Errors::REVOKED);
            }
            if record.recorded_at >= intent.expires_at {
                return failed(Errors::EXPIRED);
            }
            if record.value_usd_cents > intent.max_tx_value_usd_cents {
                return failed(Errors::TX_LIMIT);
            }
            if !self.agent_authorized.entry((intent_hash, record.agent)).read() {
                return failed(Errors::NOT_AUTHORIZED_AGENT);
            }
            ok()
        }

        fn intent_count(self: @ContractState) -> u64 {
            self.intent_count.read()
        }

        fn execution_count(self: @ContractState, intent_hash: felt252) -> u64 {
            self.intents.entry(intent_hash).read().execution_count
        }

        fn daily_spend(self: @ContractState, intent_hash: felt252, day: u64) -> u128 {
            self.daily_spend.entry((intent_hash, day)).read()
        }

        fn is_agent_authorized(
            self: @ContractState, intent_hash: felt252, agent: ContractAddress,
        ) -> bool {
            self.agent_authorized.entry((intent_hash, agent)).read()
        }

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        fn compute_policy_hash(
            self: @ContractState, canonical_chunks: Array<felt252>,
        ) -> felt252 {
            policy::compute_policy_hash(canonical_chunks.span())
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn register(ref self: ContractState, params: RegisterIntentParams) -> u64 {
            assert(!self.paused.read(), Errors::PAUSED);
            assert(params.intent_hash != 0, Errors::ZERO_HASH);
            assert(params.version != 0, Errors::VERSION_ZERO);

            let now = get_block_timestamp();
            assert(params.expires_at > now, Errors::BAD_EXPIRY);
            assert(!self.intents.entry(params.intent_hash).read().exists, Errors::INTENT_EXISTS);

            let creator = get_caller_address();
            let id = self.intent_count.read();

            let intent = Intent {
                id,
                intent_hash: params.intent_hash,
                creator,
                version: params.version,
                created_at: now,
                expires_at: params.expires_at,
                revoked_at: 0,
                max_tx_value_usd_cents: params.max_tx_value_usd_cents,
                max_daily_spend_usd_cents: params.max_daily_spend_usd_cents,
                execution_count: 0,
                total_spend_usd_cents: 0,
                exists: true,
            };
            self.intents.entry(params.intent_hash).write(intent);
            self.intent_hash_by_id.entry(id).write(params.intent_hash);
            self.intent_count.write(id + 1);

            if params.agent.is_non_zero() {
                self.agent_authorized.entry((params.intent_hash, params.agent)).write(true);
                self
                    .emit(
                        AgentAuthorizationChanged {
                            intent_hash: params.intent_hash,
                            agent: params.agent,
                            authorized: true,
                        },
                    );
            }

            self
                .emit(
                    IntentCreated {
                        intent_hash: params.intent_hash,
                        creator,
                        intent_id: id,
                        version: params.version,
                        created_at: now,
                        expires_at: params.expires_at,
                        max_tx_value_usd_cents: params.max_tx_value_usd_cents,
                        max_daily_spend_usd_cents: params.max_daily_spend_usd_cents,
                    },
                );
            id
        }
    }
}
