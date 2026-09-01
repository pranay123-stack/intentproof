# Starknet Seed Grant — demo and context

## Problem

Autonomous agents are increasingly capable of controlling blockchain accounts and
executing multi-step transactions. Users can already define wallet limits — a maximum
transfer, an allowlist of addresses — but those limits speak a different language from the
one people use. Nobody says *"cap outbound ERC-20 transfers at 500 USD equivalent"*. They
say **manage my portfolio, but never use leverage**.

Natural-language human intent is difficult to represent and harder to verify. It is also
exactly where the disputes will be. The chain already answers *did the transaction
happen*. Nothing currently answers *was it what I asked for*.

## Solution

IntentProof creates a deterministic authorization boundary between human intent and
autonomous execution.

A language model interprets prose into a structured policy. Two deterministic gates and a
human approve it. The policy's Poseidon commitment goes on Starknet — where the contract
recomputes it rather than taking our word. From that point the model is out of the loop
entirely: a deterministic engine decides every action, and every decision, including every
refusal, produces a receipt anyone can recompute.

## Why OpenAI?

OpenAI provides natural-language interpretation, which is genuinely hard and which models
are genuinely good at. The compiler uses the Responses API with a strict JSON schema, so
structural violations fail at the API boundary.

**It is not trusted for enforcement.** The integration sits behind a provider-independent
`IntentCompiler` interface. Adding Anthropic, a local model or an ensemble means writing
one class; the policy engine, the contracts and the verifier do not change, because none
of them knows a model exists.

## Why Starknet?

- **Cairo has Poseidon natively.** `register_intent_from_canonical` hands the contract the
  canonical chunks and makes it recompute the commitment with `poseidon_hash_span`. The
  same felt the TypeScript canonicalizer produced — asserted by shared test vectors in
  both suites.
- **On-chain commitments with independent enforcement.** The registry stores the numeric
  limits, so `record_execution` re-checks expiry, revocation, replay and both spending
  caps before writing. It is a second enforcement point, not a log.
- **Low-cost execution.** An authorization layer that costs more than the trades it guards
  would not get used. Per-action recording has to be cheap to be real.
- **Programmable accounts.** The natural next step — putting the policy engine inside the
  account's validation path so an agent physically cannot submit an unauthorized call — is
  a normal thing to build on Starknet and awkward elsewhere.
- **Verifiable computation ecosystem.** Phase 2 needs an on-chain proof verifier. Starknet
  is a chain built around one.

## Ecosystem benefit

The parts worth sharing are the boring ones.

`contracts/src/policy.cairo` is a set of pure functions with no storage and no caller
checks. Any Starknet contract can reuse it to enforce IntentProof-shaped authorization
without depending on our registry.

`IntentProof.checkPolicy(intent, action)` is a pure function with no client, no
environment and no I/O, so an agent framework can adopt the check without adopting
anything else from the SDK.

If several agent projects on Starknet committed to intents in a shared format, a user
could audit agents they did not build, and an agent could check a counterparty's authority
before trading with it. That is the outcome worth aiming at, and it is why the schema, the
canonical encoding and the receipt format are documented as a protocol rather than as
implementation details.

## What is built

| | |
| --- | --- |
| Cairo contracts | `IntentRegistry`, `ExecutionVerifier`, reusable `policy` library, two-step `ownable` component |
| Cairo tests | 59 passing (`snforge`) |
| TypeScript packages | schema · compiler · policy engine · Starknet client · agent · SDK |
| TypeScript tests | 127 passing (`vitest`) |
| Distribution | Libraries and contracts, not an application — the integration point is one line in someone else's agent loop |
| CLI | `pnpm demo` runs the whole pipeline; `pnpm verify:receipt` verifies a bundle independently |
| Modes | LOCAL DEMO (no credentials) · Sepolia read-only · Sepolia read-write |

## The three-minute demo script

Run in a terminal. Everything below is real output — no slides.

**0:00 — The problem (25s)**

> "An agent can hold your keys and execute multi-step strategies. What it can't do is
> prove it stayed inside what you asked for. A wallet limit stops a big transfer — it
> doesn't know you said *never use leverage*. And you can't fix that by asking the model
> to check itself: the same component that misread you will misread you again."

**0:25 — Run the pipeline (20s)**

```bash
pnpm demo --emit bundle.json
```

> "One command. It compiles a mandate, commits it, runs an agent against it, and verifies
> every receipt. Let me walk through what it just printed."

**0:45 — Compilation (30s)**

```
2 · Compiled to a structured policy
  allowed      swap
  forbidden    borrow, leverage, short
  assets       ETH, STRK
  max tx       $500
  max daily    $1,000
  source       gpt-5.6
```

> "That went to OpenAI, which returned a structured proposal. Note what it *can't* do: the
> action kinds are a closed enum, so it cannot invent a permission. And the limits are
> required — a policy without a spending cap is refused by the semantic gate before a human
> ever sees it. Note also that 'never use leverage' expanded to three forbidden actions.
> That expansion is checked, not trusted."

**1:15 — Commitment (20s)**

```
3 · Committed
  intent hash  0x0591f34eb279e1686d5fabe0302c1ced8c8723fe47b92d9837cac3176fdab5a5
  recomputed   0x0591f34eb279e1686d5fabe0302c1ced8c8723fe47b92d9837cac3176fdab5a5
  mode         LOCAL_DEMO
  transaction  none — LOCAL DEMO MODE, nothing was broadcast
```

> "Canonicalized and hashed with Poseidon. The second line is the hash recomputed from the
> stored policy — that's what makes a later edit detectable. On Sepolia the contract does
> that recomputation itself rather than taking our word for it. Here there's no chain
> configured, so it says so instead of inventing a transaction hash."

**1:35 — Enforcement (50s)**

```
4 · The agent proposes; the engine decides
  ✓ ALLOWED   Swap ETH → STRK, $420
  ✓ ALLOWED   Swap STRK → ETH, $350
  ✗ REJECTED  Borrow USDC, $2,000        action_allowed, action_not_forbidden,
                                          asset_allowed, contract_allowed,
                                          transaction_limit, daily_limit
  ✗ REJECTED  Transfer to unknown address, $180
  ✗ REJECTED  Swap ETH → DOGE, $120
  ✗ REJECTED  Swap ETH → STRK, $1,500
  ✓ ALLOWED   Swap ETH → STRK, $200
```

> "The agent has no access to the policy engine — it can't see a verdict before proposing,
> which is what makes this a test rather than a demo. And the checks don't short-circuit: a
> $2,000 borrow is wrong in six different ways and the receipt says all six."

> "The last one matters too — it's an ordinary swap of an authorized pair on an approved
> venue. It's rejected purely for size."

**2:25 — Independent verification (25s)**

```bash
pnpm verify:receipt bundle.json
```

> "This is a separate program. It holds no database — it recomputes the commitment from
> the policy, the receipt hash from the receipt, and re-runs the policy engine at each
> receipt's own timestamp. Seven receipts, all reproduce."

Then flip one `policyResult` from `REJECTED` to `ALLOWED` and run it again:

```
✗ EXECUTION NOT AUTHORIZED
    Receipt integrity: the receipt has been altered since it was sealed.
    Policy evaluation: receipt claims ALLOWED, but re-running the engine yields REJECTED.
```

> "It names the rule that failed. And notice the receipts *after* it fail too — claiming to
> have spent budget you didn't changes the ledger every later receipt was evaluated
> against. You can't forge one in isolation."

**2:50 — The honest close (10s)**

> "One thing I want to be precise about: this is not a zero-knowledge proof and I don't
> call it one. It's a verifiable execution receipt — a commitment plus a deterministic
> re-derivation. The policy predicate is already a pure function over integers and set
> membership, which is the shape that arithmetizes, so a proof layer is the next phase.
> Claiming it today would undermine the whole point."

### If asked "where does this get integrated?"

Three surfaces exist in the code:

1. **`IntentProof.checkPolicy(intent, action)`** — a pure function with no client, no
   environment and no I/O. One line inside an existing agent loop, right before the signer.
2. **`contracts/src/policy.cairo`** — pure Cairo with no storage and no caller checks. Any
   Starknet contract can enforce the same rules without depending on our registry.
3. **The registry itself** — so a third party can check an agent's authority, or a user can
   audit an agent they did not build.

The honest caveat: no third-party integration exists yet, and lining one up would
strengthen this application more than any additional code.

## Roadmap

**Phase 1 — MVP.** Built. Natural language → policy → commitment → enforcement → receipt →
verification.

**Phase 2 — Cryptographic proof generation.** Given a committed intent `I` and an
execution trace `E`, prove that every action in `E` satisfied the policy predicate of `I`
— without the verifier needing the trace. The predicate is a pure function over integers,
enums and set membership; the ledger is a fold. Proving that a *language model* reasoned
correctly is neither tractable nor useful, and is explicitly not the goal.

**Phase 3 — Composable IntentProofs.** An agent delegating to another agent should not be
able to delegate authority it does not hold. Sub-intents derived from a parent commitment,
with the child's policy provably a subset of the parent's.

**Phase 4 — Cross-agent authorization.** Agents checking each other's mandates the way
they check signatures today, with reputation derived from verified receipts rather than
self-report.

## Honest statement of limitations

- No independent security audit.
- No zero-knowledge proof is implemented or claimed.
- The agent simulates rather than trades; nothing signs a swap.
- The protocol directory ships labels, not addresses — publishing invented addresses for
  real venues would be a fabricated allowlist that looks authoritative.
- USD notionals are supplied by the caller; a production deployment needs an oracle, which
  then joins the trust model.
- Daily budgets bucket by UTC day, so waiting across midnight allows twice the cap.

## What a grant would fund

1. **The proof layer** (Phase 2), which is the technically hard and ecosystem-differentiating
   part.
2. **Account-abstraction integration**, so the engine sits in the account's validation path
   and an unauthorized call cannot be submitted at all rather than merely being recorded as
   refused.
3. **An external security review**, so the security model above stops being one author's
   assessment.
4. **Integration work with existing Starknet agent frameworks**, because a shared intent
   format is worth more than another isolated tool.
