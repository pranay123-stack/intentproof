# Protocol

The parts that have to agree byte-for-byte between TypeScript and Cairo, written out
so a third implementation could match them.

## 1. Canonical policy encoding

Two policies granting the same authority must produce the same bytes, whatever order
their fields arrived in and however their arrays were spelled.

```
intentproof/v1/policy
{"canonicalVersion":1,"policyVersion":1,"purpose":"portfolio_management",…}
```

Fields, in this exact order:

| Field | Type | Normalization |
| --- | --- | --- |
| `canonicalVersion` | integer | Bumping it changes every hash, by design |
| `policyVersion` | integer | The `IntentPolicy` document version |
| `purpose` | string | Lowercased, whitespace → underscores |
| `allowedActions` | string[] | Lowercased, deduplicated, sorted |
| `forbiddenActions` | string[] | Lowercased, deduplicated, sorted |
| `allowedAssets` | string[] | Uppercased, deduplicated, sorted |
| `allowedContracts` | string[] | Labels uppercased, addresses lowercased, sorted |
| `allowedDestinations` | string[] | Same; `[]` when absent |
| `maxTransactionValueUsdCents` | integer \| null | Integer cents |
| `maxDailySpendUsdCents` | integer \| null | Integer cents |
| `maxSlippageBps` | integer \| null | Basis points |
| `expiresAtUnix` | integer | Seconds since the epoch |
| `explanation` | string | The rationale the human read before approving |

Four decisions in that table are load-bearing:

- **Explicit field order, not `Object.keys` or a sort.** The order is part of the
  protocol, and an explicit list lets a future v2 add fields without silently reordering
  v1 commitments.
- **USD as integer cents.** Floats have no canonical decimal rendering; cents do.
  Semantic validation refuses sub-cent limits rather than rounding them.
- **Epoch seconds for the expiry.** `2026-09-02T00:00:00Z` and `2026-09-02T02:00:00+02:00`
  are the same instant and must produce the same hash.
- **The explanation is included.** It is the sentence the human actually read before
  approving. Leaving it out would let someone display one interpretation and commit to
  another.

## 2. Domain separation

Three different objects are hashed with the same primitive, so each canonical form is
prefixed with its own tag:

```
intentproof/v1/policy
intentproof/v1/action
intentproof/v1/receipt
```

Without this, a receipt whose bytes happened to coincide with a policy's would produce a
colliding commitment.

## 3. Felt packing

```
bytes  = utf8(canonical)
chunks = [bytes.length, …31-byte big-endian groups]
hash   = poseidonHashMany(chunks)      // TypeScript, @scure/starknet
hash   = poseidon_hash_span(chunks)    // Cairo, core::poseidon
```

- **31 bytes per felt**, not 32, because the Starknet field is smaller than 2²⁵².
- **The length prefix makes the encoding injective.** Without it, `"A"` and `"A\0"` pack
  to the same final chunk and two different policies could share a commitment.
- Felts are rendered as `0x` + 64 lowercase hex digits. Comparison is numeric
  (`feltEquals`), so `0x1` and `0x0…01` are recognised as equal.

### Test vectors

Asserted in both `packages/intent-schema/test/canonical.test.ts` and
`contracts/tests/test_cross_impl_hash.cairo`:

| Input | Chunks | Poseidon |
| --- | --- | --- |
| `[1, 2, 3]` (bare span) | — | `0x2f0d8840bcf3bc629598d8a6cc80cb7c0d9e52d93dab244bbf9cd0dca0ad082` |
| `{"version":1,"purpose":"portfolio_management"}` | `[0x2e, 0x7b22…, 0x696f…]` | `0xe128e4e67418440e69e30a75dff0d6161a9528e8dc7d7f034024368c4ba40e` |
| `""` | `[0]` | `0x545d6f7d28a8a398e543948be5a026af60c4dea482867a6eeb2525b35d1e1e1` |

## 4. On-chain recomputation

`register_intent_from_canonical(canonical_chunks, params)` recomputes the Poseidon hash
inside the contract and reverts on mismatch. The cheaper `register_intent` exists but
takes the caller's word for the commitment; paying for the recomputation is what turns
"we say this policy hashes to X" into something the network checked.

The registry also stores the numeric limits, so `record_execution` is an independent
enforcement point rather than a log. It evaluates, in this order:

1. `revoked_at == 0`
2. `now < expires_at`
3. `(intent_hash, receipt_hash)` not already recorded
4. `value ≤ max_tx_value_usd_cents`
5. `spent_today + value ≤ max_daily_spend_usd_cents`

The same order as the off-chain engine, so the two agree on *why* something failed.
Failures are asserts, not soft returns: an unauthorized action must not reach storage.

## 5. Execution receipts

Produced for **every** evaluated action, allowed or rejected.

```jsonc
{
  "version": 1,
  "receiptHash": "0x…",     // the seal, excluded from its own preimage
  "intentId": "ip_…",
  "intentHash": "0x…",
  "agentId": "agent_…",
  "actionId": "act_…",
  "actionHash": "0x…",
  "action": { … },
  "policyResult": "ALLOWED" | "REJECTED",
  "checks": [{ "name": …, "passed": …, "detail": … }],
  "transactionHash": "0x…" | null,
  "timestamp": "…",
  "network": "starknet-sepolia",
  "mode": "LOCAL_DEMO" | "STARKNET_SEPOLIA"
}
```

Two fields are excluded from the canonical receipt encoding:

- **`receiptHash`** is the output.
- **`transactionHash`** is excluded because the receipt is sealed when the decision is
  made, and the chain write — if there is one — happens afterwards. Committing to a field
  that does not exist yet would make the hash unstable exactly when it matters most.

The **full check list is committed** — as `name:pass|fail` pairs — not just the verdict,
so "the engine said ALLOWED" and "the engine ran these thirteen checks with these
outcomes" cannot drift apart.

## 6. The check list

Evaluated in this order, always all thirteen, never short-circuiting:

```
01  intent_hash_integrity     policy still hashes to the registered commitment
02  agent_authorized          the acting agent is the one the intent names
03  intent_not_revoked        the user has not revoked this authorization
04  intent_not_expired        the authorization has not lapsed
05  action_allowed            the action kind is in the allowed list
06  action_not_forbidden      the action kind is not in the forbidden list
07  asset_allowed             every asset touched is authorized
08  contract_allowed          the target protocol is on the allowlist
09  destination_allowed       any recipient of outbound value is on the allowlist
10  transaction_limit         within the per-transaction cap
11  slippage_limit            within the authorized slippage bound
12  daily_limit               fits inside the remaining daily budget
13  replay_protection         this action has not already been executed
```

Checks do not short-circuit because an action that is wrong in four ways should say so.
A receipt naming only the first reason would hide the rest.

Two defaults are worth stating explicitly, because the safe reading of silence is not the
obvious one:

- **A missing limit is zero authority, not unlimited authority.** Semantic validation
  refuses to create such an intent; if one arrives anyway, `transaction_limit` and
  `daily_limit` fail.
- **An empty destination allowlist means nowhere, not anywhere.**

## 7. Spend ledger

```ts
interface LedgerSnapshot {
  spentUsdByDay: Record<number, number>;   // day index → USD
  executedActionIds: string[];
}
```

`dayIndex(t) = floor(epochSeconds(t) / 86400)`, identical to `policy::day_index` in Cairo.
Only allowed actions advance the ledger: rejections are free, which is what makes it safe
for an agent to propose speculatively.

`ledgerFromHistory(receipts)` rebuilds it from a receipt list — the verifier's entry point.

## 8. Verification

A verifier holding an intent and a receipt recomputes, in order:

1. the commitment, from the canonical policy;
2. the canonical form itself, from the policy object;
3. the action hash, from the recorded action;
4. the receipt hash, from everything except itself;
5. **the decision** — by re-running the same `evaluateAction` at the timestamp the receipt
   claims, with the ledger rebuilt from prior receipts.

Step 5 is what makes forgery detectable: a receipt cannot claim `ALLOWED` for an action
the engine rejects, and cannot claim a passing check the engine fails.

Verdicts:

| Verdict | Meaning |
| --- | --- |
| `EXECUTION_WITHIN_INTENT` | Every check reproduced, including chain confirmation |
| `EXECUTION_NOT_AUTHORIZED` | At least one check failed; the report names it |
| `INDETERMINATE` | Local checks passed; no chain record was consulted |

## 9. Error codes

Cairo reports stable short strings rather than free-form messages, because off-chain
verifiers compare codes:

```
IP: intent exists          IP: unknown intent          IP: not intent creator
IP: agent not authorized   IP: already revoked         IP: intent revoked
IP: intent expired         IP: expiry in the past      IP: zero intent hash
IP: zero receipt hash      IP: policy hash mismatch    IP: receipt already recorded
IP: tx value over limit    IP: daily spend over limit  IP: unknown execution
IP: registry paused        IP: caller is not the owner IP: empty canonical form
```

## 10. Forward compatibility

`canonicalVersion` is the first field of every canonical form. A v2 encoding produces
different hashes for the same policy, which is correct: they are different commitments
under different rules, and nothing should silently treat them as equal.

The encoding was chosen so a proof system could be added without changing what anything
commits to. The policy predicate is a pure function over integers, enums and set
membership — the shape that arithmetizes cleanly — and the ledger is a fold over prior
actions. Nothing in the current design forecloses that work, and nothing in it pretends
the work is done.
