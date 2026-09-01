import {
  ACTION_KINDS,
  PROTOCOL_DIRECTORY,
  type ActionKind,
  type IntentProposal,
} from '@intentproof/intent-schema';
import { finalizeProposal } from './normalize.js';
import { assertUsableInput } from './prompt.js';
import {
  CompilationError,
  type CompileOptions,
  type CompileResult,
  type IntentCompiler,
} from './types.js';

/**
 * A rule-based compiler for when no model is available.
 *
 * This is NOT an AI. It is a keyword and pattern parser, and it is labelled as
 * such everywhere it surfaces (`isModelGenerated: false`), because a demo that
 * silently substitutes regexes for a language model and calls the result "AI
 * interpretation" is exactly the kind of claim this project exists to make
 * checkable.
 *
 * It exists so a reviewer without an OpenAI key can still exercise the parts of
 * the system that matter — canonicalization, commitment, enforcement,
 * verification — none of which depend on how the policy was drafted.
 */
export class DeterministicIntentCompiler implements IntentCompiler {
  readonly id = 'deterministic-intent-compiler';
  readonly kind = 'deterministic' as const;
  readonly model = null;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compile(input: string, options: CompileOptions = {}): Promise<CompileResult> {
    let text: string;
    try {
      text = assertUsableInput(input);
    } catch (error) {
      throw new CompilationError('input', (error as Error).message);
    }

    const now = options.now ?? new Date();
    const startedAt = Date.now();
    const proposal = parseNaturalLanguage(text);
    const { policy, warnings } = finalizeProposal(proposal, now);

    return {
      policy,
      proposal,
      warnings: [
        'This policy was drafted by a rule-based parser, not a language model. Read it especially carefully.',
        ...warnings,
      ],
      provenance: {
        compilerId: this.id,
        kind: this.kind,
        model: null,
        createdAt: now.toISOString(),
        durationMs: Date.now() - startedAt,
        isModelGenerated: false,
      },
    };
  }
}

const KNOWN_ASSETS = ['ETH', 'STRK', 'USDC', 'USDT', 'DAI', 'WBTC', 'BTC'] as const;

/** Surface forms mapped onto the closed action set. */
const ACTION_PATTERNS: readonly (readonly [RegExp, ActionKind])[] = [
  [/\b(swap|trade|exchange|convert)\w*/iu, 'swap'],
  [/\b(unstake|unstaking|withdraw\s+stake)\w*/iu, 'unstake'],
  [/\b(stake|stakes|staking)\b/iu, 'stake'],
  [/\b(transfer|send|withdraw\s+to|pay)\w*/iu, 'transfer'],
  [/\b(bridge|bridging)\w*/iu, 'bridge'],
  [/\b(borrow|borrowing|loan|lend|lending|debt)\w*/iu, 'borrow'],
  [/\b(leverage|leveraged|margin)\w*/iu, 'leverage'],
  // Bounded rather than \w*: "shortly" is not a request to open a short.
  [/\b(short|shorts|shorting)\b/iu, 'short'],
  [/\b(liquidat\w+)/iu, 'liquidate'],
  [/\b(provide\s+liquidity|add\s+liquidity|lp\b)/iu, 'provide_liquidity'],
  [/\b(remove\s+liquidity|withdraw\s+liquidity)/iu, 'remove_liquidity'],
  [/\b(claim|harvest)\w*/iu, 'claim_rewards'],
  // "approved DEXs" describes a venue list, not a token approval, so the past
  // participle is deliberately excluded.
  [/\b(approve|approves|approving|approvals?)\b/iu, 'approve'],
  [/\b(repay|repaying)\w*/iu, 'repay'],
];

const NEGATION = /\b(never|no|not|don'?t|do\s+not|avoid|without|forbid\w*|prohibit\w*|exclude)\b/iu;

/** "never use leverage" has to expand to every action that creates debt. */
const NEGATION_EXPANSIONS: Partial<Record<ActionKind, readonly ActionKind[]>> = {
  leverage: ['leverage', 'borrow', 'short'],
  borrow: ['borrow', 'leverage', 'short'],
  short: ['short', 'leverage'],
};

function clauses(text: string): string[] {
  return text
    .split(/(?:[.;!?\n]+|\s\band\b\s|,\s)/iu)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function parseUsd(text: string, patterns: readonly RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const raw = match?.[1];
    if (raw) {
      const value = Number(raw.replace(/[,$]/gu, ''));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

export function parseNaturalLanguage(text: string): IntentProposal {
  const allowed = new Set<ActionKind>();
  const forbidden = new Set<ActionKind>();

  for (const clause of clauses(text)) {
    const negated = NEGATION.test(clause);
    for (const [pattern, kind] of ACTION_PATTERNS) {
      if (!pattern.test(clause)) continue;
      if (negated) {
        for (const expanded of NEGATION_EXPANSIONS[kind] ?? [kind]) forbidden.add(expanded);
      } else {
        allowed.add(kind);
      }
    }
  }

  // A forbidden action is forbidden even if some other clause allowed it.
  for (const kind of forbidden) allowed.delete(kind);
  if (allowed.size === 0) allowed.add('swap');

  const upper = text.toUpperCase();
  const assets = KNOWN_ASSETS.filter((a) => new RegExp(`\\b${a}\\b`, 'u').test(upper));

  const maxTransactionValueUsd = parseUsd(text, [
    // "$500 per transaction"
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|a|each)\s*(?:transaction|trade|swap|tx)\b/iu,
    // "never spend more than $500 per transaction"
    /(?:max(?:imum)?|no more than|up to|limit(?:ed)? to|never spend more than|never exceed)[^.$]{0,40}\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|a|each)?\s*(?:transaction|trade|swap|tx)\b/iu,
    // "maximum transaction value is $500"
    /max(?:imum)?\s+(?:transaction|trade|swap|tx)(?:\s+(?:value|size|amount|limit))?\s*(?:is|of|:|=)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/iu,
  ]);
  const maxDailySpendUsd = parseUsd(text, [
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|a|each)\s*day/iu,
    /(?:daily|per day|a day)[^.$]{0,40}\$\s*([\d,]+(?:\.\d{1,2})?)/iu,
    /(?:max(?:imum)?\s+daily\s+(?:spend|spending))[^.$]{0,20}\$\s*([\d,]+(?:\.\d{1,2})?)/iu,
  ]);

  const slippageMatch = /([\d.]+)\s*%[^.]{0,20}slippage|slippage[^.\d]{0,20}([\d.]+)\s*%/iu.exec(text);
  const slippagePercent = Number(slippageMatch?.[1] ?? slippageMatch?.[2] ?? NaN);
  const maxSlippageBps = Number.isFinite(slippagePercent)
    ? Math.round(slippagePercent * 100)
    : 100;

  const hourMatch = /(\d+)\s*hours?/iu.exec(text);
  const dayMatch = /(\d+)\s*days?/iu.exec(text);
  const durationHours = hourMatch?.[1]
    ? Number(hourMatch[1])
    : dayMatch?.[1]
      ? Number(dayMatch[1]) * 24
      : 24;

  const namedProtocols = PROTOCOL_DIRECTORY.filter((p) => upper.includes(p.id)).map((p) => p.id);
  const allowedContracts =
    namedProtocols.length > 0
      ? namedProtocols
      : PROTOCOL_DIRECTORY.filter((p) => p.category === 'dex').map((p) => p.id);

  const transfersAllowed = allowed.has('transfer') || allowed.has('bridge');

  const inferred: string[] = [];
  if (maxTransactionValueUsd === null) inferred.push('no per-transaction limit was stated');
  if (maxDailySpendUsd === null) inferred.push('no daily limit was stated');
  if (!slippageMatch) inferred.push('no slippage bound was stated, so 1% was assumed');
  if (!hourMatch && !dayMatch) inferred.push('no expiry was stated, so 24 hours was assumed');

  const explanation = [
    `Rule-based parse (no language model was used).`,
    `Allowed: ${[...allowed].join(', ')}.`,
    forbidden.size > 0 ? `Forbidden: ${[...forbidden].join(', ')}.` : 'Nothing was explicitly forbidden.',
    assets.length > 0 ? `Assets: ${assets.join(', ')}.` : 'No assets were recognised in the text.',
    inferred.length > 0 ? `Assumptions: ${inferred.join('; ')}.` : 'Every limit came from your text.',
  ].join(' ');

  const proposal: IntentProposal = {
    purpose: 'portfolio_management',
    allowedActions: [...allowed].filter((a): a is ActionKind => ACTION_KINDS.includes(a)),
    forbiddenActions: [...forbidden],
    allowedAssets: assets.length > 0 ? [...assets] : ['ETH'],
    allowedContracts,
    allowedDestinations: transfersAllowed ? allowedContracts : [],
    maxTransactionValueUsd,
    maxDailySpendUsd:
      maxDailySpendUsd ?? (maxTransactionValueUsd === null ? null : maxTransactionValueUsd * 2),
    maxSlippageBps,
    durationHours,
    explanation,
  };
  return proposal;
}
