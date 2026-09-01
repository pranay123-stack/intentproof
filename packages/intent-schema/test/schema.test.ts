import { describe, expect, it } from 'vitest';
import {
  IntentPolicySchema,
  IntentProposalSchema,
  isResolvableContractId,
  lookupProtocol,
  PROTOCOL_DIRECTORY,
  validatePolicySemantics,
  type IntentPolicy,
} from '../src/index.js';

const NOW = new Date('2026-09-01T12:00:00Z');

const VALID: IntentPolicy = {
  version: 1,
  purpose: 'portfolio_management',
  allowedActions: ['swap'],
  forbiddenActions: ['borrow', 'leverage'],
  allowedAssets: ['ETH', 'STRK'],
  allowedContracts: ['APPROVED_DEX_1'],
  maxTransactionValueUsd: 500,
  maxDailySpendUsd: 1000,
  maxSlippageBps: 100,
  expiresAt: '2026-09-02T12:00:00Z',
  metadata: { explanation: 'Swaps only.' },
};

describe('IntentPolicySchema', () => {
  it('accepts a well-formed policy', () => {
    expect(IntentPolicySchema.safeParse(VALID).success).toBe(true);
  });

  it('refuses action kinds outside the closed set', () => {
    // The whole point of an allowlist is that the model cannot widen it by
    // inventing a name, so this has to fail at the schema, not later.
    const result = IntentPolicySchema.safeParse({
      ...VALID,
      allowedActions: ['swap_but_safe'],
    });
    expect(result.success).toBe(false);
  });

  it('refuses unknown top-level fields', () => {
    const result = IntentPolicySchema.safeParse({ ...VALID, bypassChecks: true });
    expect(result.success).toBe(false);
  });

  it('requires at least one allowed action, asset and contract', () => {
    expect(IntentPolicySchema.safeParse({ ...VALID, allowedActions: [] }).success).toBe(false);
    expect(IntentPolicySchema.safeParse({ ...VALID, allowedAssets: [] }).success).toBe(false);
    expect(IntentPolicySchema.safeParse({ ...VALID, allowedContracts: [] }).success).toBe(false);
  });

  it('refuses negative and non-finite limits', () => {
    expect(IntentPolicySchema.safeParse({ ...VALID, maxTransactionValueUsd: -1 }).success).toBe(
      false,
    );
    expect(IntentPolicySchema.safeParse({ ...VALID, maxTransactionValueUsd: 0 }).success).toBe(
      false,
    );
    expect(
      IntentPolicySchema.safeParse({ ...VALID, maxTransactionValueUsd: Infinity }).success,
    ).toBe(false);
  });

  it('refuses slippage outside 0-10000 bps', () => {
    expect(IntentPolicySchema.safeParse({ ...VALID, maxSlippageBps: 10_001 }).success).toBe(false);
    expect(IntentPolicySchema.safeParse({ ...VALID, maxSlippageBps: -1 }).success).toBe(false);
    expect(IntentPolicySchema.safeParse({ ...VALID, maxSlippageBps: 12.5 }).success).toBe(false);
  });

  it('refuses an unparseable expiry', () => {
    expect(IntentPolicySchema.safeParse({ ...VALID, expiresAt: 'next tuesday' }).success).toBe(
      false,
    );
  });

  it('pins the policy version', () => {
    expect(IntentPolicySchema.safeParse({ ...VALID, version: 2 }).success).toBe(false);
  });
});

describe('IntentProposalSchema (model-facing)', () => {
  const PROPOSAL = {
    purpose: 'portfolio_management',
    allowedActions: ['swap'],
    forbiddenActions: ['borrow'],
    allowedAssets: ['ETH'],
    allowedContracts: ['APPROVED_DEX_1'],
    allowedDestinations: null,
    maxTransactionValueUsd: 500,
    maxDailySpendUsd: 1000,
    maxSlippageBps: 100,
    durationHours: 24,
    explanation: 'ok',
  };

  it('uses nullable rather than optional, as strict structured outputs require', () => {
    expect(IntentProposalSchema.safeParse(PROPOSAL).success).toBe(true);
    // Omitting a limit is not the same as saying there is none; the model must say.
    const { maxDailySpendUsd: _omitted, ...withoutDaily } = PROPOSAL;
    expect(IntentProposalSchema.safeParse(withoutDaily).success).toBe(false);
  });

  it('does not let the model choose the schema version', () => {
    expect(IntentProposalSchema.safeParse({ ...PROPOSAL, version: 99 }).success).toBe(false);
  });
});

describe('protocol directory', () => {
  it('resolves known labels case-insensitively', () => {
    expect(lookupProtocol('approved_dex_1')?.id).toBe('APPROVED_DEX_1');
    expect(isResolvableContractId('APPROVED_DEX_2')).toBe(true);
  });

  it('accepts literal Starknet addresses', () => {
    expect(isResolvableContractId('0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7')).toBe(
      true,
    );
  });

  it('refuses invented protocol names', () => {
    expect(isResolvableContractId('SuperSafeDEX')).toBe(false);
    expect(isResolvableContractId('APPROVED_DEX_9')).toBe(false);
  });

  it('publishes no fabricated addresses', () => {
    // Shipping invented addresses for real protocols would be an allowlist that
    // looks authoritative and is not.
    for (const entry of PROTOCOL_DIRECTORY) {
      expect(entry.address).toBeNull();
    }
  });
});

describe('semantic validation', () => {
  const check = (policy: IntentPolicy) => validatePolicySemantics(policy, { now: NOW });

  it('passes a sound policy', () => {
    expect(check(VALID).ok).toBe(true);
    expect(check(VALID).errors).toHaveLength(0);
  });

  it('rejects an action that is both allowed and forbidden', () => {
    const result = check({ ...VALID, allowedActions: ['swap', 'borrow'] });
    expect(result.ok).toBe(false);
    expect(result.errors.map((i) => i.field)).toContain('allowedActions');
  });

  it('rejects an authorization with no per-transaction cap', () => {
    const { maxTransactionValueUsd: _drop, ...noCap } = VALID;
    const result = check(noCap);
    expect(result.ok).toBe(false);
    expect(result.errors.some((i) => i.field === 'maxTransactionValueUsd')).toBe(true);
  });

  it('rejects an authorization with no daily cap', () => {
    const { maxDailySpendUsd: _drop, ...noCap } = VALID;
    expect(check(noCap as IntentPolicy).ok).toBe(false);
  });

  it('rejects an already-expired authorization', () => {
    expect(check({ ...VALID, expiresAt: '2026-08-31T00:00:00Z' }).ok).toBe(false);
  });

  it('rejects an authorization that outlives the ceiling', () => {
    const result = check({ ...VALID, expiresAt: '2027-09-01T00:00:00Z' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((i) => i.field === 'expiresAt')).toBe(true);
  });

  it('rejects sub-cent limits that cannot be committed exactly', () => {
    expect(check({ ...VALID, maxTransactionValueUsd: 500.005 }).ok).toBe(false);
  });

  it('rejects absurd slippage', () => {
    expect(check({ ...VALID, maxSlippageBps: 9000 }).ok).toBe(false);
  });

  it('rejects protocol labels that are not in the directory', () => {
    const result = check({ ...VALID, allowedContracts: ['TOTALLY_LEGIT_DEX'] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((i) => i.field === 'allowedContracts')).toBe(true);
  });

  it('rejects transfer authority with no destination allowlist', () => {
    // Silence about recipients has to mean "nowhere", never "anywhere".
    const result = check({ ...VALID, allowedActions: ['swap', 'transfer'] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((i) => i.field === 'allowedDestinations')).toBe(true);
  });

  it('accepts transfer authority once destinations are named', () => {
    const result = check({
      ...VALID,
      allowedActions: ['swap', 'transfer'],
      allowedDestinations: ['APPROVED_DEX_1'],
    });
    expect(result.ok).toBe(true);
  });

  it('treats an inverted cap pair as an advisory, not a blocker', () => {
    const result = check({ ...VALID, maxDailySpendUsd: 100 });
    expect(result.ok).toBe(true);
    expect(result.advisories.some((i) => i.field === 'maxDailySpendUsd')).toBe(true);
  });
});
