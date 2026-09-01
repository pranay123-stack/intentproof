# Contributing

Adversarial review of the security model is the most useful thing you can bring.

## Getting set up

```bash
pnpm install
pnpm build:packages
pnpm verify          # lint + typecheck + both test suites + production build
```

Node 22+ and pnpm are required. Cairo work also needs scarb 2.20 and snforge 0.63.

## Things that will fail CI

- **Changing a contract's external interface without running `node scripts/sync-abi.mjs`.**
  The ABI in `packages/starknet/src/abi` is generated source; a stale copy means the client
  and the deployed class disagree silently, so CI diffs it.
- **Changing the canonical encoding without updating both sets of test vectors.** The
  TypeScript and Cairo implementations are pinned to each other by shared Poseidon vectors
  in `packages/intent-schema/test/canonical.test.ts` and
  `contracts/tests/test_cross_impl_hash.cairo`. That is deliberate: a drift in either
  should break a build in the other half of the repository.
- **A test that makes a network request.** The OpenAI compiler is exercised through an
  injected client stub. A suite that depends on a live model is neither deterministic nor
  runnable in CI, and it tests OpenAI rather than IntentProof.

## Things to be careful about

- **Never widen what the model can decide.** If a change would let a compiler output reach
  enforcement without passing the schema gate, the semantic gate and a human, it is the
  wrong change however convenient.
- **Never fabricate a chain fact.** `ChainAnchor` is built only from a hash returned by a
  node, and explorer links only from an anchor. `LocalRegistryClient` returns `null` rather
  than a plausible-looking placeholder, and that is load-bearing.
- **Do not add a protocol address you have not verified.** The directory ships labels with
  `address: null` on purpose; there is a test asserting it.
- **Do not describe anything here as a proof.** It is a verifiable execution receipt until
  a real proof system exists.

## Commit and PR style

Small, self-contained changes with the reasoning in the message. If a change affects the
protocol — canonical form, hashing, receipt shape, check order — say so explicitly, because
those changes invalidate existing commitments.
