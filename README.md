# IntentProof

**Prove that autonomous agents did what humans actually authorized.**

Cairo contracts and a TypeScript SDK that put a deterministic authorization boundary
between human intent and autonomous execution on Starknet.

```
Human intent → OpenAI → structured policy → human approval → Starknet commitment
             → constrained agent → deterministic enforcement → receipt → verification
```

The whole design follows from one line:

> The AI can interpret and plan, but the AI cannot decide what it is authorized to do.

---

## What is IntentProof?

A person writes what an agent may do, in ordinary language. A language model turns that
into a structured policy. The person approves it. From that moment the model is out of
the loop: a deterministic engine decides every action, the policy's commitment lives on
Starknet, and every decision — including every refusal — produces a receipt anyone can
recompute without trusting the party that produced it.

It ships as **libraries and contracts**, not an application. The intended integration
point is one line inside somebody else's agent loop:

```ts
const result = IntentProof.checkPolicy(intent, action);
if (!result.allowed) throw new Error(result.reasons.join('; '));
```

## Problem

Autonomous agents can already hold keys, sign transactions and chain multi-step
strategies across protocols. What they cannot do is prove afterwards that they stayed
inside what a person asked for.

Wallet limits are the wrong shape for this. A maximum-transfer rule stops a large
transaction; it does not know you said *never use leverage*. Natural-language intent is
where the disputes will actually be: not "did the transaction happen", which the chain
already answers, but "was it what I asked for", which nothing currently answers at all.

The instinctive fix — ask the model to check its own compliance — puts the same untrusted
component on both sides of the boundary. A model that misread the instruction will misread
it again when auditing itself, and a prompt-injected model will report success.

## Solution

| Stage | Who does it | Trusted? |
| --- | --- | --- |
| Interpret the words | OpenAI | **No** |
| Validate the structure | Zod schema, closed enums | Yes — ordinary code |
| Validate the meaning | Semantic gate | Yes — ordinary code |
| Approve | Human | Yes — by definition |
| Commit | Poseidon hash → Starknet `IntentRegistry` | Yes — the chain recomputes it |
| Propose actions | AI agent | **No** |
| Decide | Deterministic policy engine, 13 checks | Yes — pure function |
| Record | Execution receipt, sealed for allow *and* reject | Yes |
| Verify | Anyone, from the receipt alone | — |

## Why Starknet?

- **Poseidon is native to Cairo.** Registration goes through
  `register_intent_from_canonical`, which hands the contract the canonical chunks and
  makes *it* recompute the hash — so the stored commitment was checked by the network,
  not merely asserted by a client.
- **Cheap execution makes per-action recording viable.** An authorization layer that costs
  more than the trades it guards would not get used.
- **Native account abstraction.** The next step is putting the policy engine inside the
  account's validation path, so an unauthorized call cannot be submitted at all.
- **Proving infrastructure already exists.** Phase 2 needs an on-chain verifier.

## Why OpenAI?

Because interpreting prose is genuinely hard and models are genuinely good at it. The
compiler uses the **Responses API with a strict JSON schema** derived from a Zod schema,
so structural violations fail at the API boundary rather than in a hopeful parser.

It is not trusted for enforcement. The integration sits behind a provider-independent
interface:

```ts
interface IntentCompiler {
  compile(input: string): Promise<CompileResult>;
}
```

Adding Anthropic, a local model or an ensemble means writing one class. The policy engine,
the contracts and the verifier do not change, because none of them knows a model exists.

## Architecture

```
                      USER
                        │  plain language
                        ▼
        ┌───────────── untrusted ─────────────┐
        │            OpenAI API               │
        │                ▼                    │
        │     Structured intent proposal      │
        └────────────────┬────────────────────┘
                         ▼
                 Schema validation          closed enums, no unknown fields
                         ▼
                Semantic validation         no unbounded grants, known protocols
                         ▼
                 HUMAN APPROVAL             explicit, required, revocable
                         ▼
                 Canonical policy           deterministic byte encoding
                         ▼
                   Intent hash              Poseidon over 31-byte chunks
                         ▼
                    STARKNET                IntentRegistry recomputes the hash
                         ▼
        ┌───────────── untrusted ─────────────┐
        │             AI AGENT                │  proposes, sees no verdicts
        └────────────────┬────────────────────┘
                         ▼
                  POLICY ENGINE              deterministic, 13 checks, no model
                    ╱          ╲
                ALLOW          REJECT
                   │              │
              Execution        Blocked
                   ╲            ╱
                 Receipt generator           sealed at decision time
                         ▼
                     VERIFIER                recomputes everything
```

**The critical trust boundary:** the LLM is not the enforcement mechanism. It proposes an
interpretation. The deterministic policy engine enforces authorization. Starknet provides
the commitment and the independent verification surface.

Full detail in [`docs/architecture.md`](docs/architecture.md) and
[`docs/protocol.md`](docs/protocol.md).

## Security model

Full threat model in [`docs/security-model.md`](docs/security-model.md). Summary:

| Threat | What it runs into |
| --- | --- |
| Prompt injection | Output is a proposal, not an authorization: closed-enum schema → semantic gate → human review |
| LLM hallucination | Human approval is mandatory; the explanation shown is inside the commitment |
| Malicious agent | No path from agent to engine; the chain re-checks limits in `record_execution` |
| Malicious tool | Protocol allowlist; unresolvable identifiers fail at policy-creation time |
| Unauthorized destination | Transfers need an explicit destination list — silence means nowhere |
| Policy modification | Poseidon commitment over the whole canonical policy; verification reports it separately |
| Replay | Action ids off chain; `(intent_hash, receipt_hash)` keys on chain |
| Expiry | Derived from the clock, never stored as status; enforced in both places |
| Spending limits | Per-transaction and daily caps, mirrored on chain, identical UTC day buckets |

## Local development

Requires **Node 22+** and **pnpm**. Cairo work additionally needs
[scarb](https://docs.swmansion.com/scarb/) 2.20 and
[snforge](https://foundry-rs.github.io/starknet-foundry/) 0.63.

```bash
pnpm install
pnpm build:packages
pnpm verify              # lint + typecheck + 127 TS tests + 59 Cairo tests
```

### Run the whole pipeline

```bash
pnpm demo
pnpm demo "Swap ETH and STRK, never borrow, max \$250 per trade and \$500 a day"
```

With **no configuration at all** this runs in LOCAL DEMO MODE: real canonicalization, real
Poseidon commitments, real enforcement, real receipts, real verification — and no
blockchain. It never prints a transaction hash it did not receive from a node.

### Verify a receipt independently

```bash
pnpm demo --emit bundle.json
pnpm verify:receipt bundle.json
cat bundle.json | pnpm verify:receipt      # stdin also works
```

The verifier recomputes every hash and re-runs the policy engine at each receipt's own
timestamp. Nothing is looked up in a database — a verifier you have to trust to hold the
data is not a verifier. Exits non-zero if any receipt fails.

Try tampering with one: flip a `policyResult` from `REJECTED` to `ALLOWED` and the verifier
names both `receipt_integrity` and `policy_evaluation`. The forgery also cascades — a
receipt that claims to have spent budget it did not changes the ledger every later receipt
was evaluated against.

## OpenAI setup

```bash
# .env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6
```

- Requests are sent with `store: false`.
- Neither the prompt nor the model output is logged or included in an error message.
- Optional policy fields are expressed as **nullable, not omitted**: a model that leaves
  out a spending limit has said nothing about it, and silence is not worth interpreting.
- `INTENTPROOF_ALLOW_FALLBACK_COMPILER=false` makes a missing key a hard error instead of
  falling back to the rule-based parser.

Without a key, a **rule-based parser** drafts policies. It is not an AI and reports
`isModelGenerated: false`. It exists so a reviewer without a key can still exercise the
parts that matter — none of which depend on how the policy was drafted.

## Starknet Sepolia setup

```bash
pnpm build:cairo
./scripts/deploy-sepolia         # or: pnpm deploy:sepolia
```

The script checks every precondition before it starts — RPC reachable, account deployed,
build artifacts present — and writes the addresses to `deployments/sepolia.json` the
moment they exist. Then:

```bash
# .env
STARKNET_RPC_URL=https://starknet-sepolia.drpc.org
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...          # never commit
INTENT_REGISTRY_ADDRESS=0x...
EXECUTION_VERIFIER_ADDRESS=0x...
STARKNET_NETWORK=sepolia
```

A registry address **alone** enables read-only chain mode: existing intents can be read and
verified without a signing key. Adding the key enables registration, revocation and
execution recording.

## SDK

```ts
import { IntentProof } from '@intentproof/sdk';

const compiled = await IntentProof.compileIntent({
  naturalLanguage: `
    Manage my portfolio.
    Swap ETH and STRK.
    Never use leverage.
    Maximum $500 per transaction.
  `,
});

// Show compiled.policy to the user and get an explicit approval. Only then:
const { intent } = await IntentProof.authorize({ policy: compiled.policy });

const result = IntentProof.checkAction(intent, action);
if (!result.allowed) {
  throw new Error(`Intent violation: ${result.reasons.join('; ')}`);
}
```

Deterministic checking with no client, no environment and no I/O — the form intended for
an agent loop:

```ts
IntentProof.checkPolicy(intent, action);   // pure function
```

There is no method that evaluates an action against anything but the deterministic engine,
and no way to ask a model whether something is permitted. That absence is the API design.

### The human-approval step

`authorize()` takes an **already-approved** policy. The SDK cannot tell whether a human
actually looked, so an integrator must supply that step — in a wallet's approval flow, or
in their own product's UI. The approval screen is where the security argument lives, and
it belongs where the user already is rather than on a separate site.

What that screen needs to show, at minimum:

- every permission and every refusal, with equal weight;
- every limit in the units the user used;
- what the model had to assume;
- the commitment hash, recomputed live if the user edits anything.

## Cairo contracts

```
contracts/src/
├── intent_registry.cairo       IntentRegistry — commitments, agents, executions
├── execution_verifier.cairo    ExecutionVerifier — stateless recomputation + registry read
├── policy.cairo                reusable pure policy library (no storage, no auth)
├── types.cairo                 Intent, ExecutionRecord, VerificationResult, IntentStatus
├── errors.cairo                stable short-string error codes
└── components/ownable.cairo    two-step ownable component
```

`IntentRegistry` exposes `register_intent`, `register_intent_from_canonical`,
`revoke_intent`, `authorize_agent`, `record_execution`, `attest_execution`, `get_intent`,
`is_intent_active`, `verify_execution`, `compute_policy_hash` and emits `IntentCreated`,
`IntentRevoked`, `AgentAuthorizationChanged`, `ExecutionRecorded`, `ExecutionVerified`.

Two things are worth noting:

1. **The chain is a second enforcement point, not a log.** `record_execution` re-checks
   revocation, expiry, replay, the per-transaction cap and the daily budget before it
   writes, in the same order as the off-chain engine.
2. **Access control is real.** Only an intent's creator can revoke it or change its agent
   allowlist. The contract owner can pause new writes and can neither forge, alter nor
   revoke another account's intent — there is a test for exactly that.

`policy.cairo` carries no storage and no caller checks, so any Starknet contract can reuse
it to enforce IntentProof-shaped authorization without depending on our registry.

## Testing

```bash
pnpm test          # TypeScript — schema, canonicalization, engine, compiler, SDK, agent
pnpm test:cairo    # snforge — contracts, policy library, cross-implementation hashes
pnpm verify        # everything above, plus lint and typecheck
```

No test makes a network request. The OpenAI compiler is exercised through an injected
client stub, which is what lets the suite cover refusals, truncated responses and malformed
proposals — cases a live model would produce only by accident.

The TypeScript and Cairo implementations are pinned to each other by **shared Poseidon test
vectors** asserted in both suites (`packages/intent-schema/test/canonical.test.ts` and
`contracts/tests/test_cross_impl_hash.cairo`). A drift in either breaks a build.

CI additionally runs the end-to-end demo with no secrets and verifies the bundle it
produces, so LOCAL DEMO MODE stays a working configuration rather than a claim.

## Current limitations

- **No independent security audit.** IntentProof is an experimental MVP. Do not use it to
  protect real funds.
- **No zero-knowledge proof.** What exists is a *verifiable execution receipt*: a
  cryptographic commitment plus a deterministic re-derivation. No proof system is
  implemented and none is claimed.
- **No third-party integration exists yet.** The SDK surface is designed for one, and none
  has been built.
- **The agent simulates rather than trades.** Nothing signs a swap. The engine sits where a
  real integration would put it — in front of the signer.
- **The human-approval UI is the integrator's to build.** The SDK enforces that a policy is
  approved before it is committed; it cannot enforce that a human read it.
- **The protocol directory ships labels, not addresses.** Publishing invented addresses for
  real venues would be a fabricated allowlist that looks authoritative.
- **USD notionals are supplied by the caller.** A production deployment needs an oracle,
  and the oracle then becomes part of the trust model.
- **Daily budgets bucket by UTC day.** An attacker who waits can spend twice the cap across
  a midnight boundary. A rolling window is the obvious v2 fix.

## Roadmap

| Phase | Status | What it solves |
| --- | --- | --- |
| **1 — MVP** | Built | Intent → policy → commitment → enforcement → receipt → verification |
| **2 — Proof generation** | Designed | Prove `E` satisfies `I` without replaying the trace |
| **3 — Composable intents** | Research | Sub-intents provably a subset of their parent |
| **4 — Cross-agent authorization** | Research | Counterparty authority checks; reputation from verified receipts |

On Phase 2 specifically: proving that a language model reasoned correctly is neither
tractable nor useful. The tractable statement is narrower — given a committed intent `I`
and an execution trace `E`, prove every action in `E` satisfied the policy predicate of
`I`. That predicate is already a pure function over integers, enums and set membership,
which is the shape that arithmetizes cleanly. Until it exists, this project says
"verifiable execution receipt" and means it literally.

## Grant context

Built for a [Starknet Seed Grant](https://www.starknet.io/grants/seed-grants/)
application. See [`docs/grant-demo.md`](docs/grant-demo.md) for the demo script and the
ecosystem argument.

**IntentProof is an experimental MVP and has not undergone an independent security audit.**

## Repository layout

```
intentproof/
├── packages/
│   ├── intent-schema/          schema, canonicalization, Poseidon commitments, receipts
│   ├── intent-compiler/        IntentCompiler interface + OpenAI + rule-based + static
│   ├── policy-engine/          deterministic evaluation, ledger, replay
│   ├── starknet/               registry client (chain + local), ABIs, explorer links
│   ├── agent/                  agent simulator and strategies
│   └── sdk/                    @intentproof/sdk facade
├── contracts/                  Cairo 2.20 · snforge
├── docs/                       architecture, security model, protocol, grant demo
├── scripts/                    demo · verify-receipt · deploy-sepolia · sync-abi
└── deployments/                addresses written by the deploy script
```

## License

MIT. See [LICENSE](LICENSE).
