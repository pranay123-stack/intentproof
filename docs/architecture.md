# Architecture

## The one-line version

The LLM is not the enforcement mechanism. It proposes an interpretation; a
deterministic policy engine enforces authorization; Starknet holds the commitment
neither of them can quietly edit.

## Why the roles are split

The failure mode this system exists to prevent is subtle. It is not that a model will
obviously misbehave — it is that a model asked to both interpret an instruction *and*
check its own compliance will make the same mistake twice and report success. Prompt
injection makes this worse: the attacker controls the input to both roles at once.

So the roles are split, and the split is structural rather than advisory:

- `packages/intent-compiler` can produce a `CompileResult`. It has no reference to the
  policy engine, no access to a private key, and no way to register anything.
- `packages/policy-engine` has no network access, no model call and no configuration.
  Its core is a pure function of `(intent, action, now, ledger)`.
- `packages/agent` imports the schema package and nothing else. An agent that could
  inspect the engine could shape its proposals to pass, and the demo would prove nothing.

## Data flow

```
USER  ──plain language──▶  OpenAI  ──▶  IntentProposal
                                          │
                          schema gate ────┤  closed enums, no unknown fields,
                                          │  nullable rather than optional
                       semantic gate ─────┤  no unbounded grants, resolvable protocols,
                                          │  transfers need destinations, TTL ceiling
                     HUMAN APPROVAL ──────┤  explicit, revocable, shown the exact hash
                                          ▼
                                   IntentPolicy
                                          │
                        canonicalize ─────┤  fixed field order, normalized arrays,
                                          │  USD as integer cents, epoch seconds
                              commit ─────┤  Poseidon over [len, …31-byte chunks]
                                          ▼
                        STARKNET IntentRegistry
                    register_intent_from_canonical
                    (the contract recomputes the hash)
                                          │
   AI AGENT ──proposes AgentAction──▶ POLICY ENGINE ──▶ ALLOW │ REJECT
                                          │                   │
                                          └──── receipt ──────┘
                                                   │
                                              VERIFIER
```

## Package boundaries

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `intent-schema` | Zod schemas, canonicalization, Poseidon commitments, receipts | `zod`, `@scure/starknet` |
| `intent-compiler` | Natural language → `IntentProposal` | `intent-schema`, `openai` |
| `policy-engine` | The authority: 13 checks, ledger, replay | `intent-schema` |
| `starknet` | `RegistryClient` — chain and local implementations | `intent-schema`, `starknet` |
| `agent` | Proposal generation | `intent-schema` |
| `sdk` | Facade over all of the above | all |

`intent-schema` has no Node-only dependencies, so canonicalization and hashing run
identically in a browser. An integrator building the approval screen can therefore
recompute the commitment client-side on every edit, which is what makes "changing this
limit changes what you are committing to" visible rather than asserted.

## The two-implementation problem

The commitment is only meaningful if TypeScript and Cairo compute the same felt. Three
things keep them in step:

1. **One canonical encoding, written out explicitly.** Field order is a literal list in
   the source, not `Object.keys` and not a sort. The order is part of the protocol.
2. **The same primitive.** `poseidonHashMany` from `@scure/starknet` and
   `poseidon_hash_span` from `core::poseidon` agree by construction.
3. **Shared test vectors.** The same three inputs are asserted in
   `packages/intent-schema/test/canonical.test.ts` and
   `contracts/tests/test_cross_impl_hash.cairo`. A drift in either implementation breaks
   a build in the other half of the repository.

## Execution modes

`RegistryClient` has two implementations behind one type, and the application code above
them is identical.

- **`LocalRegistryClient`** — every method that would return a `ChainAnchor` returns
  `null`. Not "a fake anchor", not "an empty string": `null`, so no caller can render a
  transaction hash by accident. `verifyExecution` returns `null` too, because "the chain
  has no opinion" and "the chain says no" are different answers.
- **`StarknetRegistryClient`** — real RPC. Anchors are built only from a hash returned by
  a node, and explorer links only from an anchor.

A third state exists and is worth naming: **read-only chain mode**, when a registry
address is configured but no signing key is. Reading and verifying existing intents is
genuinely useful, and it is better than pretending the chain is unreachable.

## Verification has three verdicts, not two

- `EXECUTION_WITHIN_INTENT` — every check reproduced, including chain confirmation.
- `EXECUTION_NOT_AUTHORIZED` — at least one check failed. The report names which.
- `INDETERMINATE` — every recomputable check passed, but no chain record was consulted.

The third exists because reporting a locally-verified receipt as *proven* would be the
single most misleading thing this system could do. Local demo mode always lands here, and
`pnpm verify:receipt` says so in words rather than leaving it to a colour.

## Where the guarantees stop

IntentProof cannot tell you the model understood you correctly. It can tell you that
whatever a human approved is exactly what was enforced, and that the record of what
happened — including every refusal — is one an independent party can check without
trusting the party that produced it.

It also does not execute trades. The MVP evaluates and records; a production integration
puts the engine in front of a real signer, which is where the remaining work is.
