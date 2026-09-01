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
| TypeScript tests | 137 passing (`vitest`) |
| Web app | Next.js 16, 10 routes, 7 API endpoints, production build clean |
| Modes | LOCAL DEMO (no credentials) · Sepolia read-only · Sepolia read-write |

## The three-minute demo script

**0:00 — The problem (25s)**

> "An agent can hold your keys and execute multi-step strategies. What it can't do is
> prove it stayed inside what you asked for. A wallet limit stops a big transfer — it
> doesn't know you said *never use leverage*. And you can't fix that by asking the model
> to check itself: the same component that misread you will misread you again."

**0:25 — Compile (35s)**

Open the homepage. The example is already in the box:

> *Manage my Starknet portfolio. You may swap ETH and STRK. Never use leverage or
> borrowing. Maximum transaction value is $500. Maximum daily spending is $1,000. Only
> use approved DEXs. Authorization expires after 24 hours.*

Press **Compile intent**.

> "That went to OpenAI, which returned a structured proposal. Note what it can't do: the
> action kinds are a closed enum, so it can't invent a permission. And the limits are
> required — a policy without a spending cap is refused by the semantic gate before I ever
> see it."

**1:00 — Review and edit (30s)**

Point at the amber banner. Press **Edit intent**, change the per-transaction cap.

> "This is the part that matters. I read what it understood, and I can change it. Watch
> the commitment at the bottom — it changes with every keystroke. That hash is what makes
> a later edit detectable."

Change it back. Press **Approve intent**.

> "Canonicalized, hashed with Poseidon, registered. Sepolia when a registry is configured;
> otherwise it says LOCAL DEMO MODE and shows no transaction, because there isn't one."

**1:30 — Run the agent (45s)**

Press **Run agent**.

> "Seven proposals. The agent has no access to the policy engine — it can't see a verdict
> before proposing, which is what makes this a test rather than a demo."

Read the table:

```
swap ETH → STRK      $420     ✓ ALLOWED
swap STRK → ETH      $350     ✓ ALLOWED
borrow USDC        $2,000     ✗ REJECTED   forbidden action, unauthorized asset,
                                            unapproved venue, over both caps
transfer → 0x04b2…   $180     ✗ REJECTED   no destination allowlist at all
swap ETH → DOGE      $120     ✗ REJECTED   asset not authorized
swap ETH → STRK    $1,500     ✗ REJECTED   over the $500 per-transaction cap
swap ETH → STRK      $200     ✓ ALLOWED
```

Expand the borrow row.

> "Every check, and why. It doesn't stop at the first failure — a $2,000 borrow is wrong
> in six ways and the receipt says all six."

**2:15 — Receipts and verification (35s)**

Press **Inspect receipts**, then **Verify**.

> "Every action produced a sealed receipt, including the refusals. What the agent *tried*
> is as much a part of the record as what it did."

> "Verification recomputes everything: the commitment from the policy, the receipt hash
> from the receipt, and then it re-runs the policy engine at each receipt's own timestamp.
> Seven actions evaluated, three allowed, four rejected, **zero unauthorized
> executions**."

**2:50 — The honest close (10s)**

> "One thing I want to be precise about: this is not a zero-knowledge proof and I don't
> call it one. It's a verifiable execution receipt — a commitment plus a deterministic
> re-derivation. The policy predicate is already a pure function over integers and set
> membership, which is the shape that arithmetizes, so a proof layer is the next phase.
> Claiming it today would undermine the whole point."

### Optional 20-second follow-up: tamper detection

On `/verify`, paste a receipt with `policyResult` flipped from `REJECTED` to `ALLOWED`.

```
EXECUTION NOT AUTHORIZED
✗ Receipt integrity — the receipt has been altered since it was sealed.
✗ Policy evaluation — receipt claims ALLOWED, but re-running the engine yields REJECTED.
```

> "It names the rule that failed. That's the deliverable."

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
