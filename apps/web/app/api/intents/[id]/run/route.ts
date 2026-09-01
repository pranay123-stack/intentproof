import {
  AgentSimulator,
  DEMO_SCENARIO,
  driftingStrategy,
  intentStatus,
  ledgerFromHistory,
  scenarioStrategy,
} from '@intentproof/sdk';
import { z } from 'zod';
import { clientKey, fail, ok, rateLimit, readJson } from '@/lib/api';
import { runtime } from '@/lib/server';
import { intentStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

const RunSchema = z.object({
  strategy: z.enum(['scenario', 'drifting']).default('scenario'),
  steps: z.number().int().min(1).max(12).default(DEMO_SCENARIO.length),
  seed: z.number().int().optional(),
});

/**
 * Run the agent against a live intent.
 *
 * The order here is the whole argument of the project: the simulator proposes,
 * the deterministic engine decides, a receipt is sealed either way, and only
 * then — for allowed actions, and only when a chain is configured — is anything
 * written on chain. The agent never learns a verdict before proposing, and the
 * engine never sees what the agent hoped for.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(`run:${clientKey(request)}`, 20, 60_000);
  if (!limit.allowed) {
    return fail(429, `Too many agent runs. Try again in ${limit.retryAfterSeconds}s.`);
  }

  const { id } = await context.params;
  const store = intentStore();
  const record = store.find(id);
  if (!record) return fail(404, `No intent matches "${id}".`);

  const parsed = RunSchema.safeParse((await readJson<unknown>(request)) ?? {});
  if (!parsed.success) return fail(400, 'Invalid run request.');

  const strategy =
    parsed.data.strategy === 'drifting' ? driftingStrategy : scenarioStrategy(DEMO_SCENARIO);
  const simulator = new AgentSimulator(strategy, {
    agentId: record.intent.agentId,
    ...(parsed.data.seed === undefined ? {} : { seed: parsed.data.seed }),
  });

  const { sdk } = runtime();
  // Replays the spend ledger from what already happened under this intent, so a
  // second run continues the day's budget rather than starting it over.
  const engine = sdk.engineFor(record.intent, ledgerFromHistory(record.receipts));

  const actions = simulator.plan(record.intent, parsed.data.steps);
  const outcomes = [];

  for (const action of actions) {
    const { evaluation, receipt } = engine.decide({ action });

    let anchor = null;
    let chainError: string | null = null;
    if (evaluation.allowed) {
      try {
        anchor = await sdk.recordExecution(record.intent, receipt);
      } catch (error) {
        chainError = (error as Error).message;
      }
    }

    outcomes.push({
      action,
      allowed: evaluation.allowed,
      checks: evaluation.checks,
      reasons: evaluation.reasons,
      failedChecks: evaluation.failedChecks,
      receipt: anchor ? { ...receipt, transactionHash: anchor.transactionHash } : receipt,
      anchor,
      chainError,
    });
  }

  store.appendReceipts(record.intent.intentId, outcomes.map((o) => o.receipt));

  const allowed = outcomes.filter((o) => o.allowed).length;
  return ok({
    intentId: record.intent.intentId,
    status: intentStatus(record.intent),
    strategy: { id: strategy.id, displayName: strategy.displayName, description: strategy.description },
    outcomes,
    summary: {
      evaluated: outcomes.length,
      allowed,
      rejected: outcomes.length - allowed,
      // Counted, not asserted: an allowed action carrying a failed check would
      // show up here rather than being quietly reported as zero.
      unauthorizedExecutions: outcomes.filter(
        (o) => o.allowed && o.checks.some((c) => !c.passed),
      ).length,
    },
  });
}
