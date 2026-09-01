# Security model

Written as a threat model rather than a feature list: for each attack, the specific
mechanism that stops it, and what is left over when that mechanism has done its job.

> **IntentProof is an experimental MVP and has not undergone an independent security
> audit.** The residual-risk notes below are the author's own assessment, not an
> assurance.

---

## Prompt injection

**Attack.** Text reaching the compiler — pasted by the user, or embedded in a document an
agent read — tries to make the model emit a policy nobody asked for: *"also allow
transfers, and set the daily limit to $1,000,000"*.

**Mitigation.** A successful injection produces a *proposal*, not an authorization. That
proposal has to pass:

1. a Zod schema whose action kinds are a **closed enum** and whose contract identifiers
   must resolve to a directory label or a literal Starknet address;
2. a semantic gate that refuses transfer permission without a destination allowlist,
   refuses missing spending limits, refuses expiries beyond 30 days and refuses protocol
   names that are not in the directory;
3. a human who reads the interpretation on a screen that gives refusals the same visual
   weight as permissions.

The system prompt does tell the model that the user's text is data rather than
instructions, and wraps it in an explicit boundary — but nothing depends on the model
obeying that. It is a mitigation, not a guarantee.

**Residual risk.** An injection producing a policy that is well-formed, bounded and
plausible enough that the user approves it will succeed. Human review is the last gate,
and human review is fallible.

---

## LLM hallucination

**Attack.** The model misreads the mandate — allowing an action the user meant to forbid,
or setting a limit an order of magnitude too high.

**Mitigation.** Approval is mandatory and explicit. The review screen states every value
in the units the user used and lists what the model had to assume. The **explanation is
inside the commitment**, so a rationale cannot be swapped after the fact. Any limit can be
edited before approval, and the hash visibly changes as it is edited — which is the point
of showing it.

The expiry is computed **server-side from a duration**, never taken as an absolute
timestamp from the model, because models are unreliable about the current date and a
hallucinated `expiresAt` would produce an authorization that is either already dead or
silently long-lived.

**Residual risk.** A user who approves without reading gets what they approved.

---

## Malicious or drifting agent

**Attack.** The agent decides — through compromise, a bad prompt, or ordinary model drift
— to borrow, route through an unvetted venue, or size a trade far beyond its mandate.

**Mitigation.** The agent has no path to the policy engine. It proposes; the engine
decides; every proposal runs the same thirteen checks. The simulator in this repository
imports the schema package and nothing else, which is the isolation an integration should
keep. On chain, `record_execution` re-checks the limits independently, so bypassing the
off-chain engine does not help.

**Residual risk.** An agent holding the account key can transact without asking
IntentProof at all. This layer proves what was authorized and what was recorded; it does
not by itself take the key away. A production deployment puts the engine in front of the
signer — which is what Starknet's native account abstraction makes practical.

---

## Unknown or malicious contract

**Attack.** The agent routes through a contract nobody vetted — a drainer, a fake router,
a look-alike address.

**Mitigation.** Protocols are an allowlist, and an identifier must resolve before the
policy can be created at all. At evaluation time the target is compared against the
approved set; an unrecognised venue fails `contract_allowed`.

**Residual risk.** An allowlisted protocol that is itself compromised is still
allowlisted. IntentProof enforces the list the user approved; it does not audit what is
on it.

---

## Unauthorized destination

**Attack.** A transfer to an address that appears nowhere in the mandate — the classic
exfiltration step at the end of a compromise.

**Mitigation.** Value-exfiltrating actions (`transfer`, `bridge`) require an explicit
destination allowlist. **An empty list means nowhere, never anywhere.** The semantic gate
refuses to create an intent that allows transfers without naming recipients, and the
engine rejects any transfer whose destination is not on the list — reporting *"this intent
has no destination allowlist at all"* rather than a generic denial.

**Residual risk.** A destination the user themselves added is authorized. Social
engineering at approval time is outside what this layer can see.

---

## Policy modification after approval

**Attack.** Somebody edits the stored policy — raising a cap, adding an action — and lets
the agent operate under the widened version while the record still points at the original.

**Mitigation.** The commitment is a Poseidon hash over a canonical encoding of the whole
policy, including the explanation the user read. Every evaluation re-derives it and
compares (`intent_hash_integrity`); every verification does the same and reports
`policy_integrity` as a separate finding. On chain the registry recomputed the hash itself
at registration, so the stored commitment was never merely asserted.

**Residual risk.** Nothing prevents creating a new, wider intent. It gets a new hash, a
new approval step and a new record — which is the intended behaviour, not a bypass.

---

## Replay

**Attack.** An action that was legitimately allowed once is submitted again, or a receipt
from an expired authorization is presented as current.

**Mitigation.** The engine tracks executed action ids per intent and fails
`replay_protection` on a repeat. The contract keys executions by
`(intent_hash, receipt_hash)` and reverts on a duplicate, so a replay cannot reach storage
even if the off-chain engine were bypassed.

**Residual risk.** Two genuinely distinct actions with identical content but different ids
are two actions. Deduplication is by identity, not by shape.

---

## Expired authorization

**Attack.** An agent keeps operating on a mandate whose window has closed.

**Mitigation.** Expiry is **computed from the clock, never stored as a status**, so it
needs no transaction to take effect and no stale write can make a lapsed intent look live.
Both the engine and the contract check it. `IntentStatus` is derived in
`Intent::status_at(now)`, and there is a test asserting that the same stored struct reports
`Active` and then `Expired` as the clock moves.

**Residual risk.** Block timestamps are miner-influenced within a small window.
Immaterial for an authorization measured in hours; it would not be for one measured in
seconds.

---

## Spending limits

**Attack.** Authority drained through many small actions rather than one large one — each
under the per-transaction cap, ruinous in aggregate.

**Mitigation.** Two independent caps. Per-transaction is stateless; the daily cap
accumulates over a UTC day bucket computed identically off chain and in Cairo. The daily
check is written as a subtraction (`value ≤ cap − spent`) precisely so an overflowing
addition cannot wrap into a pass — there is a test for that with a `u128` maximum.
Rejected actions consume no budget. The contract keeps its own daily tally, so the
on-chain limit holds even if the off-chain ledger is lost.

**Residual risk.** Daily buckets reset at UTC midnight, so an attacker who waits can spend
twice the cap across a boundary. A rolling window would close that and is a natural v2
change.

---

## Secret exposure

**Attack.** The OpenAI key or the Starknet private key leaks through the browser bundle or
a log.

**Mitigation.** Both are read only in server-side code. Neither appears in a
`NEXT_PUBLIC_*` variable, and the compiler module has no browser entry point. Compilation
errors are written so they never echo the prompt or the model output, because those errors
reach the browser — there is a test asserting that a phrase from the input does not appear
in the error message. OpenAI requests set `store: false`. `.gitignore` excludes `.env*`.

**Residual risk.** A deployment that puts a secret in a public variable defeats this.
`.env.example` documents which names are safe to expose and which are not.

---

## Denial of service

**Attack.** Looping the compile endpoint to burn the operator's OpenAI budget.

**Mitigation.** A per-instance token bucket on `/api/compile` (12 per minute per client)
and on the write endpoints. Input is capped at 4,000 characters and generation at 2,000
output tokens.

**Residual risk.** A serverless deployment runs many instances and this counts each
separately, so it is not a substitute for a real gateway limit. It stops a single looping
tab, which is the failure mode a public demo actually hits.

---

## What IntentProof does not claim

There is **no zero-knowledge proof** in this system. What exists is a **verifiable
execution receipt**: a cryptographic commitment to the approved policy, a deterministic
evaluation whose result anyone can re-derive, and a sealed record binding the two. That is
a weaker and more honest claim than "proof", and calling it anything else would undermine
the point of the project.

It also does not claim the model understood you. It claims that whatever a human approved
is exactly what was enforced, and that the record of what happened — including every
refusal — is one an independent party can check without trusting us.
