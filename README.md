<div align="center">

# IntentProof

### Prove that autonomous agents did what humans actually authorized.

An authorization and verification layer for AI agents on Starknet.

[![CI](https://github.com/pranay123-stack/intentproof/actions/workflows/ci.yml/badge.svg)](https://github.com/pranay123-stack/intentproof/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-186%20passing-2ea043)](#verify-every-claim-on-this-page-yourself)
[![Cairo](https://img.shields.io/badge/Cairo-2.20-6e5494)](contracts/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**[Try it in 60 seconds](#try-it-in-60-seconds)** · **[The idea](#the-problem-nobody-has-solved)** · **[Why Starknet](#why-starknet-specifically)** · **[What a grant funds](#what-a-grant-would-fund)**

</div>

---

## The problem nobody has solved

An AI agent can already hold your keys and execute multi-step strategies across protocols.
It cannot prove afterwards that it stayed inside what you asked for.

Wallet limits are the wrong shape for this. A maximum-transfer rule stops a large
transaction — it has no idea you said *never use leverage*. Nobody says *"cap outbound
ERC-20 transfers at 500 USD equivalent."* They say **"manage my portfolio, but don't get
clever."**

The chain already answers *did the transaction happen*. **Nothing answers *was it what I
asked for*.** That second question is where every dispute about agent behaviour is going to
land, and it is currently unanswerable.

The instinctive fix — have the model check its own compliance — fails for a structural
reason: it puts the same untrusted component on both sides of the boundary. A model that
misread your instruction will misread it again when auditing itself. A prompt-injected model
will confidently report success.

## The idea

> **The AI can interpret and plan. The AI cannot decide what it is authorized to do.**

Interpretation and enforcement are split, and only one of them is trusted.

| Stage | Who does it | Trusted |
| --- | --- | :---: |
| Interpret the words | OpenAI | ❌ |
| Validate the structure | Zod schema, closed enums | ✅ ordinary code |
| Validate the meaning | Semantic gate | ✅ ordinary code |
| **Approve** | **Human** | ✅ by definition |
| Commit | Poseidon hash → Starknet `IntentRegistry` | ✅ the chain recomputes it |
| Propose actions | AI agent | ❌ |
| **Decide** | **Deterministic engine, 13 checks** | ✅ pure function |
| Record | Receipt, sealed for allow *and* reject | ✅ |
| Verify | Anyone, from the receipt alone | — |

Everything the model touches is red. Everything that decides anything is green. There is no
code path in this repository where a model's output reaches enforcement without passing a
schema gate, a semantic gate, and a human.

---

## Try it in 60 seconds

No API key. No wallet. No blockchain. No signup.

```bash
git clone https://github.com/pranay123-stack/intentproof && cd intentproof
nvm use 22 && pnpm install && pnpm build:packages
pnpm demo
```

Real output, captured from that command:

```
2 · Compiled to a structured policy
  allowed      swap
  forbidden    leverage, borrow, short     ← "never use leverage" expanded to three action
  assets       ETH, STRK                      kinds, and the expansion is checked, not trusted
  max tx       $500
  max daily    $1,000
  source       rule-based parser (no model)

3 · Committed
  intent hash  0x001e750d543a68c1dab3651ecde9fe46e796e7ae49c4b2d3ffa86af63e4cdae0
  recomputed   0x001e750d543a68c1dab3651ecde9fe46e796e7ae49c4b2d3ffa86af63e4cdae0
  mode         LOCAL_DEMO
  transaction  none — LOCAL DEMO MODE, nothing was broadcast

4 · The agent proposes; the engine decides
  ✓ ALLOWED   Swap ETH → STRK, $420
  ✓ ALLOWED   Swap STRK → ETH, $350
  ✗ REJECTED  Borrow USDC, $2,000     action_allowed, action_not_forbidden, asset_allowed,
                                       contract_allowed, transaction_limit, daily_limit
              "borrow" is explicitly forbidden by this authorization.
              USDC not in the authorized asset set (ETH, STRK).
              $2,000 exceeds the $500 per-transaction cap.                    (+3 more)
  ✗ REJECTED  Transfer to an unknown address, $180
              Destination 0x04b2c1a9…f5e4 is not authorized: this intent has
              no destination allowlist at all.
  ✗ REJECTED  Swap ETH → DOGE, $120   DOGE not in the authorized asset set.
  ✗ REJECTED  Swap ETH → STRK, $1,500 $1,500 exceeds the $500 per-transaction cap.
  ✓ ALLOWED   Swap ETH → STRK, $200

Result
  7 actions evaluated · 3 allowed · 4 rejected · 0 unauthorized executions

  EXECUTION REMAINED WITHIN AUTHORIZED INTENT
```

Your hash will differ from the one above, and that is correct: expiry is computed from *now*,
so the same words on a different day are a different authorization. The two hash lines
matching each other is the property that matters — the second is recomputed from the stored
policy, which is what makes a later edit detectable.

Two lines are worth pausing on.

`source: rule-based parser (no model)` — with no `OPENAI_API_KEY` a deterministic parser
drafts the policy, and it says so rather than implying an AI was involved. Set a key and that
line names the model instead. **Everything downstream is byte-identical either way**, which is
the point: the enforcement guarantees do not depend on how the policy was drafted.

`transaction: none` — there is no chain configured, so no transaction hash is shown. Not a
placeholder, not a zero. The type system makes it impossible to render one that did not come
from a node.

The agent has **no access to the policy engine**. It cannot see a verdict before proposing —
enforced by the package dependency graph, not by convention. That is what makes this a test
rather than a demonstration.

---

## Verify every claim on this page yourself

This is not a project you have to take on trust. That is the entire point of it.

```bash
pnpm demo --emit bundle.json     # produces an intent + 7 receipts
pnpm verify:receipt bundle.json  # a separate program, holding no database
```

The verifier recomputes the commitment from the policy, the receipt hash from the receipt,
and **re-runs the policy engine at each receipt's own timestamp**. Nothing is looked up. A
verifier you have to trust to hold the data is not a verifier.

Now forge one. Open `bundle.json`, find a receipt, change `"policyResult": "REJECTED"` to
`"ALLOWED"`, and run it again:

```
✗ EXECUTION NOT AUTHORIZED
    Receipt integrity: the receipt has been altered since it was sealed.
    Policy evaluation: receipt claims ALLOWED, but re-running the engine yields REJECTED.
```

**And every receipt after it also fails.** Claiming to have spent budget you did not changes
the ledger every later receipt was evaluated against. You cannot forge one in isolation.

---

## What makes this technically non-trivial

Four things that took real work and that a reviewer can check in the source.

#### The chain recomputes the commitment — it does not take our word for it

Registration goes through `register_intent_from_canonical`, which hands the contract the
canonical byte-chunks and makes **it** compute the Poseidon hash, reverting on mismatch. The
cheaper `register_intent` exists and would have the chain trust the client. Paying for the
recomputation is what turns *"we say this policy hashes to X"* into something the network
checked.

#### TypeScript and Cairo are pinned to each other by shared test vectors

A commitment is meaningless unless both implementations produce the same felt. The same
three Poseidon vectors are asserted in
[`packages/intent-schema/test/canonical.test.ts`](packages/intent-schema/test/canonical.test.ts)
and [`contracts/tests/test_cross_impl_hash.cairo`](contracts/tests/test_cross_impl_hash.cairo).
**A drift in either implementation breaks a build in the other half of the repository.**

#### The chain is a second enforcement point, not a log

`record_execution` independently re-checks revocation, expiry, replay, the per-transaction
cap and the daily budget before writing — in the same order as the off-chain engine, using
the same `policy.cairo` primitives. An agent that bypassed the off-chain engine entirely
still cannot get an over-limit action into the record.

#### Local mode cannot fabricate a transaction

`LocalRegistryClient` returns `null` for every chain anchor. Not an empty string, not a
placeholder — `null`, so the type system makes it impossible for any caller to render a
transaction hash that did not come from a node. "The chain has no opinion" and "the chain
says no" are also different return values, because they are different answers.

---

## Why Starknet specifically

Not "we needed a chain." Four properties this design actually depends on:

| | |
| --- | --- |
| **Poseidon is native to Cairo** | The commitment scheme isn't bolted on. `poseidon_hash_span` in the contract produces the same felt as `@scure/starknet` off-chain, so on-chain recomputation costs almost nothing. On an EVM chain this would be prohibitive. |
| **Cheap execution** | An authorization layer that costs more than the trades it guards will not be adopted. Per-action recording has to be near-free to be real. |
| **Native account abstraction** | The next step — putting the policy engine inside the account's `__validate__` path, so an unauthorized call cannot even be *submitted* — is a normal thing to build on Starknet and awkward everywhere else. |
| **Existing proving infrastructure** | Phase 2 needs an on-chain proof verifier. Starknet is a chain built around one. |

---

## Where it gets integrated

IntentProof ships as **libraries and contracts, not an application**. Three integration
surfaces exist in the code today.

**1 — One line in an existing agent loop.** A pure function: no client, no environment, no
I/O, same verdict on any machine.

```ts
import { IntentProof } from '@intentproof/sdk';

const action = await myAgent.decideNextTrade();   // unchanged

const result = IntentProof.checkPolicy(intent, action);
if (!result.allowed) throw new Error(result.reasons.join('; '));

await wallet.execute(action);                     // only reached if authorized
```

**2 — Inside another Cairo contract.** [`contracts/src/policy.cairo`](contracts/src/policy.cairo)
has no storage, no `get_caller_address`, no access control. Just functions. Any Starknet
contract can enforce the same rules without depending on our registry.

**3 — As a shared registry.** A DEX asking *"what is this agent actually authorized to do?"*
A counterparty agent checking a mandate before trading. A user auditing an agent **they did
not build**, without trusting its operator.

The third is where the network effect lives. One project using this proves compliance to
itself; several projects sharing an intent format makes agent authority *legible across the
ecosystem*.

---

## Security model

Full threat model in [`docs/security-model.md`](docs/security-model.md), written as attack →
mitigation → **residual risk**, because a threat model without the third column is marketing.

| Threat | What it runs into |
| --- | --- |
| **Prompt injection** | Output is a proposal, not an authorization. Closed-enum schema → semantic gate → human review. The system prompt tells the model its input is data; nothing depends on it obeying. |
| **LLM hallucination** | Approval is mandatory. The explanation the human read is *inside* the commitment, so a rationale cannot be swapped after the fact. |
| **Malicious agent** | No path from agent to engine. The chain re-checks limits independently. |
| **Unvetted contract** | Protocol allowlist; unresolvable identifiers fail at policy-creation time, not at execution. |
| **Unauthorized destination** | Transfers require an explicit recipient list. **Silence means nowhere, never anywhere.** |
| **Policy modification** | Poseidon commitment over the whole canonical policy; verification reports integrity as its own finding. |
| **Replay** | Action ids off chain; `(intent_hash, receipt_hash)` keys on chain. |
| **Expiry** | Derived from the clock, never stored as a status — no stale write can make a lapsed intent look live. |
| **Spending limits** | Per-transaction and daily caps mirrored on chain, identical UTC day buckets. The daily check is written as a subtraction so an overflow cannot wrap into a pass. |

---

## What is built

| | |
| --- | --- |
| **Cairo** | 782 lines across 8 modules · `IntentRegistry`, `ExecutionVerifier`, a reusable pure policy library, a two-step ownable component |
| **TypeScript** | 2,699 lines across 6 packages · schema · compiler · engine · chain client · agent · SDK |
| **Tests** | **186 passing** — 127 TypeScript (vitest) + 59 Cairo (snforge), 2,505 lines of test code |
| **CI** | 3 jobs, all green. Runs the full demo **with no secrets**, then independently verifies the bundle it produced. |
| **Modes** | Local demo (zero config) · Sepolia read-only · Sepolia read-write |

CI running the end-to-end demo with no credentials is deliberate: it means "this works
without configuration" is a tested property, not a sentence in a README.

---

## Roadmap

| Phase | Status | What it solves |
| --- | --- | --- |
| **1 — MVP** | ✅ **Built** | Intent → policy → commitment → enforcement → receipt → verification |
| **2 — Proof generation** | 📐 Designed | Prove `E` satisfies `I` without the verifier replaying the trace |
| **3 — Composable intents** | 🔬 Research | Sub-intents provably a subset of their parent's authority |
| **4 — Cross-agent authorization** | 🔬 Research | Counterparty authority checks; reputation from verified receipts |

### On Phase 2, precisely

It would be easy to call Phase 1 a proof system and collect the credibility attached to the
word. That would be false, and it would also be the wrong ambition — proving that a language
model *reasoned correctly* is neither tractable nor useful.

The tractable statement is narrower. Given a committed intent `I` and an execution trace `E`,
prove every action in `E` satisfied the policy predicate of `I` — without the verifier
needing the trace, and without trusting whoever produced it.

That predicate is already a pure function over integers, enums and set membership — the shape
that arithmetizes cleanly. The spend ledger is a fold over prior actions. The groundwork is
deliberate, and the encoding was designed so a proof layer can be added without changing what
anything commits to.

**Until that exists, this project says "verifiable execution receipt" and means it literally.**

---

## What a grant would fund

1. **The proof layer (Phase 2)** — the technically hard, ecosystem-differentiating part, and
   the one that most needs Starknet's proving infrastructure.
2. **Account-abstraction integration** — moving the engine into the account's validation path,
   so an unauthorized call cannot be submitted rather than merely recorded as refused. This is
   the highest-leverage Starknet-native work.
3. **External security review** — so `docs/security-model.md` stops being one author's
   assessment.
4. **Integration with existing Starknet agent frameworks** — a shared intent format is worth
   more to the ecosystem than another isolated tool.

---

## Honest limitations

Stated plainly, because a project about verifiable claims that overstated its own would be
self-refuting.

- **No independent security audit.** Experimental MVP. Do not use it to protect real funds.
- **No zero-knowledge proof.** What exists is a *verifiable execution receipt*: a
  cryptographic commitment plus a deterministic re-derivation. No proof system is implemented
  and none is claimed.
- **No third-party integration exists yet.** The SDK is designed for one; none has been built.
- **Not deployed to Sepolia.** The deploy script is written and its preconditions tested
  against the live network, but no funded account was available.
- **The agent simulates rather than trades.** Nothing signs a swap. The engine sits where a
  real integration would put it — in front of the signer.
- **The approval UI is the integrator's to build.** The SDK enforces that a policy is approved
  before it is committed; it cannot enforce that a human read it.
- **The protocol directory ships labels, not addresses.** Publishing invented addresses for
  real venues would be a fabricated allowlist that looks authoritative — there is a test
  asserting every entry's address is `null`.
- **USD notionals are supplied by the caller.** Production needs an oracle, and the oracle
  then joins the trust model.
- **Daily budgets bucket by UTC day**, so waiting across midnight allows twice the cap. A
  rolling window is the obvious v2 fix.

---

<details>
<summary><b>Setup, SDK reference and contract details</b></summary>

### Requirements

Node 22+ and pnpm. Cairo work also needs [scarb](https://docs.swmansion.com/scarb/) 2.20 and
[snforge](https://foundry-rs.github.io/starknet-foundry/) 0.63.

```bash
pnpm install
pnpm build:packages
pnpm verify              # lint + typecheck + 127 TS tests + 59 Cairo tests
```

### OpenAI

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6
```

Uses the **Responses API with a strict JSON schema** derived from a Zod schema, so structural
violations fail at the API boundary rather than in a hopeful parser. Requests set
`store: false`. Neither the prompt nor the model output is logged or included in an error
message — there is a test asserting a phrase from the input never appears in an error.

Optional policy fields are **nullable, not omitted**: a model that leaves out a spending limit
has said nothing about it, and silence is not worth interpreting.

Without a key, a rule-based parser drafts policies. It is not an AI and reports
`isModelGenerated: false`. It exists so a reviewer without a key can exercise everything that
matters — none of which depends on how the policy was drafted.

### Starknet Sepolia

```bash
pnpm build:cairo
./scripts/deploy-sepolia
```

Checks every precondition before it starts — RPC reachable, account deployed, artifacts
present — and writes addresses to `deployments/sepolia.json` the moment they exist.

```bash
STARKNET_RPC_URL=https://starknet-sepolia.drpc.org
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...          # never commit
INTENT_REGISTRY_ADDRESS=0x...
STARKNET_NETWORK=sepolia
```

A registry address **alone** enables read-only mode: existing intents can be read and verified
without a signing key.

### SDK

```ts
import { IntentProof } from '@intentproof/sdk';

const compiled = await IntentProof.compileIntent({
  naturalLanguage: 'Manage my portfolio. Swap ETH and STRK. Never use leverage. Max $500 per transaction.',
});

// Show compiled.policy to the user and get explicit approval. Only then:
const { intent } = await IntentProof.authorize({ policy: compiled.policy });

const result = IntentProof.checkAction(intent, action);
if (!result.allowed) throw new Error(`Intent violation: ${result.reasons.join('; ')}`);
```

There is no method that evaluates an action against anything but the deterministic engine, and
no way to ask a model whether something is permitted. **That absence is the API design.**

`authorize()` takes an **already-approved** policy. The SDK cannot tell whether a human looked,
so an integrator supplies that step — in a wallet's approval flow, or their own product's UI.
Such a screen should show every permission and every refusal with equal weight, every limit in
the units the user used, what the model had to assume, and the commitment hash recomputed live
as the user edits. `intent-schema` runs in a browser precisely so that last part is cheap.

### Contracts

```
contracts/src/
├── intent_registry.cairo       commitments, agent allowlists, executions, on-chain limits
├── execution_verifier.cairo    stateless recomputation + registry read
├── policy.cairo                reusable pure library — no storage, no auth
├── types.cairo                 Intent, ExecutionRecord, VerificationResult, IntentStatus
├── errors.cairo                stable short-string error codes
└── components/ownable.cairo    two-step ownable
```

**Access control is real.** Only an intent's creator can revoke it or change its agent
allowlist. The contract owner can pause new writes and can neither forge, alter nor revoke
another account's intent — there is a test named for exactly that.

### The check list

All thirteen run on every evaluation, in a fixed order committed inside each receipt. They do
**not** short-circuit: a $2,000 borrow against a swap-only mandate is wrong in six different
ways, and a receipt naming only the first would hide five of them.

```
01 intent_hash_integrity   05 action_allowed         09 destination_allowed   13 replay_protection
02 agent_authorized        06 action_not_forbidden   10 transaction_limit
03 intent_not_revoked      07 asset_allowed          11 slippage_limit
04 intent_not_expired      08 contract_allowed       12 daily_limit
```

Two defaults are deliberate, because the safe reading of silence is not the obvious one:
**a missing limit is zero authority, not unlimited authority**, and **an empty destination
allowlist means nowhere, not anywhere**.

### Testing

```bash
pnpm test          # TypeScript
pnpm test:cairo    # snforge
pnpm verify        # everything, plus lint and typecheck
```

No test makes a network request. The OpenAI compiler is exercised through an injected client
stub, which is what lets the suite cover refusals, truncated responses and malformed proposals
— cases a live model would produce only by accident.

### Documentation

| | |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Package boundaries, execution modes, where the guarantees stop |
| [`docs/protocol.md`](docs/protocol.md) | Canonical encoding, felt packing, receipt format, test vectors |
| [`docs/security-model.md`](docs/security-model.md) | Attack → mitigation → residual risk |
| [`docs/grant-demo.md`](docs/grant-demo.md) | Three-minute demo script and the ecosystem argument |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | What will fail CI, and what to be careful about |

</details>

---

<div align="center">

**Built for a [Starknet Seed Grant](https://www.starknet.io/grants/seed-grants/) application.**

IntentProof is an experimental MVP and has not undergone an independent security audit.
No zero-knowledge proof is implemented or claimed.

MIT licensed · [Report an issue](https://github.com/pranay123-stack/intentproof/issues) ·
Adversarial review of the security model is the most useful contribution you can make.

</div>
