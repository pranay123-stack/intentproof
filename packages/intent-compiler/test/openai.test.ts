import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import {
  CompilationError,
  DeterministicIntentCompiler,
  OpenAIIntentCompiler,
  StaticIntentCompiler,
  selectIntentCompiler,
} from '../src/index.js';

const NOW = new Date('2026-09-01T12:00:00Z');

const GOOD_PROPOSAL = {
  purpose: 'portfolio_management',
  allowedActions: ['swap'],
  forbiddenActions: ['borrow', 'leverage', 'short'],
  allowedAssets: ['ETH', 'STRK'],
  allowedContracts: ['APPROVED_DEX_1', 'APPROVED_DEX_2'],
  allowedDestinations: null,
  maxTransactionValueUsd: 500,
  maxDailySpendUsd: 1000,
  maxSlippageBps: 100,
  durationHours: 24,
  explanation: 'Swaps between ETH and STRK on approved venues. Borrowing and leverage refused.',
};

/**
 * A stand-in for the OpenAI client.
 *
 * The suite must never make a network call: a test that depends on a live model
 * is neither deterministic nor runnable in CI, and it would test OpenAI rather
 * than IntentProof. Everything downstream of `output_parsed` is ours, and that
 * is what these exercise.
 */
function stubClient(response: Record<string, unknown>): OpenAI {
  return {
    responses: {
      // eslint-disable-next-line @typescript-eslint/require-await
      parse: async () => response,
    },
  } as unknown as OpenAI;
}

const compilerFor = (response: Record<string, unknown>) =>
  new OpenAIIntentCompiler({ client: stubClient(response), model: 'gpt-5.6' });

const INPUT = 'Manage my Starknet portfolio. You may swap ETH and STRK. Never use leverage.';

describe('OpenAIIntentCompiler — happy path', () => {
  it('turns a valid proposal into a policy', async () => {
    const compiler = compilerFor({
      id: 'resp_123',
      status: 'completed',
      output_parsed: GOOD_PROPOSAL,
      usage: { input_tokens: 400, output_tokens: 120 },
    });
    const result = await compiler.compile(INPUT, { now: NOW });

    expect(result.policy.allowedActions).toEqual(['swap']);
    expect(result.policy.forbiddenActions).toContain('leverage');
    expect(result.policy.maxTransactionValueUsd).toBe(500);
    expect(result.policy.metadata?.explanation).toContain('Borrowing and leverage refused');
    expect(result.provenance.isModelGenerated).toBe(true);
    expect(result.provenance.model).toBe('gpt-5.6');
    expect(result.provenance.requestId).toBe('resp_123');
    expect(result.provenance.usage).toEqual({ inputTokens: 400, outputTokens: 120 });
  });

  it('computes the expiry from the server clock, not from the model', async () => {
    // Models are unreliable about "now", so they are asked for a duration and
    // never for an absolute timestamp.
    const compiler = compilerFor({ status: 'completed', output_parsed: GOOD_PROPOSAL });
    const result = await compiler.compile(INPUT, { now: NOW });
    expect(result.policy.expiresAt).toBe('2026-09-02T12:00:00Z');
  });

  it('clamps an absurd duration to the ceiling', async () => {
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: { ...GOOD_PROPOSAL, durationHours: 100_000 },
    });
    const result = await compiler.compile(INPUT, { now: NOW });
    const ttlDays = (Date.parse(result.policy.expiresAt) - NOW.getTime()) / 86_400_000;
    expect(ttlDays).toBe(30);
  });
});

describe('OpenAIIntentCompiler — the schema gate', () => {
  it('refuses an action kind the model invented', async () => {
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: { ...GOOD_PROPOSAL, allowedActions: ['swap_but_only_safely'] },
    });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({
      name: 'CompilationError',
      stage: 'schema',
    });
  });

  it('refuses a proposal with a field missing', async () => {
    const { maxDailySpendUsd: _drop, ...incomplete } = GOOD_PROPOSAL;
    const compiler = compilerFor({ status: 'completed', output_parsed: incomplete });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({ stage: 'schema' });
  });

  it('refuses a proposal with an out-of-range value', async () => {
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: { ...GOOD_PROPOSAL, maxSlippageBps: 999_999 },
    });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({ stage: 'schema' });
  });

  it('refuses a proposal that is not an object at all', async () => {
    const compiler = compilerFor({ status: 'completed', output_parsed: null });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({ stage: 'schema' });
  });
});

describe('OpenAIIntentCompiler — the semantic gate', () => {
  it('refuses a policy with no spending limits, however well-formed', async () => {
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: {
        ...GOOD_PROPOSAL,
        maxTransactionValueUsd: null,
        maxDailySpendUsd: null,
      },
    });
    const error = await compiler.compile(INPUT, { now: NOW }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompilationError);
    expect((error as CompilationError).stage).toBe('semantic');
    expect((error as CompilationError).issues.join(' ')).toContain('unbounded authority');
  });

  it('refuses transfer authority the model granted without a destination list', async () => {
    // This is the shape a successful prompt injection would take: a policy that
    // parses cleanly and quietly widens what the agent may do.
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: {
        ...GOOD_PROPOSAL,
        allowedActions: ['swap', 'transfer'],
        forbiddenActions: [],
        allowedDestinations: null,
      },
    });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({
      stage: 'semantic',
    });
  });

  it('refuses a protocol the model invented', async () => {
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: { ...GOOD_PROPOSAL, allowedContracts: ['TOTALLY_SAFE_DEX'] },
    });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({
      stage: 'semantic',
    });
  });
});

describe('OpenAIIntentCompiler — transport failures', () => {
  it('reports a refusal without treating it as a policy', async () => {
    const compiler = compilerFor({
      status: 'completed',
      output_parsed: null,
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help.' }] }],
    });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({
      stage: 'refusal',
    });
  });

  it('reports a truncated response rather than salvaging it', async () => {
    const compiler = compilerFor({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_parsed: GOOD_PROPOSAL,
    });
    await expect(compiler.compile(INPUT, { now: NOW })).rejects.toMatchObject({
      stage: 'request',
    });
  });

  it('does not leak the prompt into the error message', async () => {
    const secretish = `${INPUT} my seed phrase is correct horse battery staple`;
    const compiler = new OpenAIIntentCompiler({
      client: {
        responses: {
          parse: () => Promise.reject(new Error('connection reset')),
        },
      } as unknown as OpenAI,
    });
    const error = await compiler.compile(secretish, { now: NOW }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('battery staple');
    expect((error as CompilationError).stage).toBe('request');
  });

  it('rejects input that is too short or too long before any request', async () => {
    const compiler = compilerFor({ status: 'completed', output_parsed: GOOD_PROPOSAL });
    await expect(compiler.compile('swap', { now: NOW })).rejects.toMatchObject({ stage: 'input' });
    await expect(compiler.compile('x'.repeat(5000), { now: NOW })).rejects.toMatchObject({
      stage: 'input',
    });
  });
});

describe('DeterministicIntentCompiler', () => {
  const compiler = new DeterministicIntentCompiler();

  it('parses the canonical demo instruction', async () => {
    const result = await compiler.compile(
      'Manage my Starknet portfolio. You may swap ETH and STRK. Never use leverage or borrowing. Maximum transaction value is $500. Maximum daily spending is $1,000. Authorization expires after 24 hours.',
      { now: NOW },
    );

    expect(result.policy.allowedActions).toContain('swap');
    expect(result.policy.forbiddenActions).toEqual(
      expect.arrayContaining(['borrow', 'leverage', 'short']),
    );
    expect(result.policy.allowedAssets).toEqual(expect.arrayContaining(['ETH', 'STRK']));
    expect(result.policy.maxTransactionValueUsd).toBe(500);
    expect(result.policy.maxDailySpendUsd).toBe(1000);
    expect(result.policy.expiresAt).toBe('2026-09-02T12:00:00Z');
  });

  it('never claims to be a language model', async () => {
    const result = await compiler.compile(
      'Swap ETH and STRK, never borrow, max $200 per transaction, $400 per day.',
      { now: NOW },
    );
    expect(result.provenance.isModelGenerated).toBe(false);
    expect(result.provenance.model).toBeNull();
    expect(result.warnings[0]).toContain('not a language model');
    expect(result.policy.metadata?.explanation).toContain('no language model was used');
  });

  it('lets a prohibition override an earlier permission', async () => {
    const result = await compiler.compile(
      'You can swap and borrow if needed. Actually, never borrow. Max $100 per transaction and $200 per day.',
      { now: NOW },
    );
    expect(result.policy.allowedActions).not.toContain('borrow');
    expect(result.policy.forbiddenActions).toContain('borrow');
  });

  it('refuses to invent limits that were never stated', async () => {
    // With no cap in the text there is nothing to authorize, and guessing one
    // would be exactly the failure the semantic gate exists to prevent.
    await expect(
      compiler.compile('Swap ETH and STRK whenever you think it is a good idea.', { now: NOW }),
    ).rejects.toMatchObject({ stage: 'semantic' });
  });
});

describe('StaticIntentCompiler', () => {
  it('pushes a supplied proposal through the same gates', async () => {
    const compiler = new StaticIntentCompiler(GOOD_PROPOSAL);
    const result = await compiler.compile(INPUT, { now: NOW });
    expect(result.policy.purpose).toBe('portfolio_management');
    expect(result.provenance.isModelGenerated).toBe(false);
  });
});

describe('selectIntentCompiler', () => {
  it('chooses OpenAI when a key is present', () => {
    const { compiler, reason } = selectIntentCompiler({ OPENAI_API_KEY: 'sk-test' });
    expect(compiler.kind).toBe('llm');
    expect(reason).toContain('OpenAI');
  });

  it('falls back only when the operator allowed it, and says so', () => {
    const { compiler, reason } = selectIntentCompiler({});
    expect(compiler.kind).toBe('deterministic');
    expect(reason).toContain('No language model was involved');
  });

  it('errors rather than substituting quietly when the fallback is disabled', () => {
    expect(() =>
      selectIntentCompiler({ INTENTPROOF_ALLOW_FALLBACK_COMPILER: 'false' }),
    ).toThrow(/not set/u);
  });
});
