import {
  IntentPolicySchema,
  intentDisplayNumber,
  intentStatus,
  validatePolicySemantics,
} from '@intentproof/sdk';
import { z } from 'zod';
import { clientKey, fail, ok, rateLimit, readJson } from '@/lib/api';
import { runtime } from '@/lib/server';
import { intentStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  policy: IntentPolicySchema,
  /** The words the user typed, kept for provenance on the intent page. */
  sourceText: z.string().max(4000).default(''),
  compiler: z
    .object({
      compilerId: z.string(),
      kind: z.enum(['llm', 'deterministic']),
      model: z.string().nullable(),
      isModelGenerated: z.boolean(),
      createdAt: z.string(),
      durationMs: z.number(),
    })
    .optional(),
  warnings: z.array(z.string()).default([]),
});

export function GET() {
  const records = intentStore().list();
  return ok({
    intents: records.map((record) => ({
      intentId: record.intent.intentId,
      displayNumber: intentDisplayNumber(record.intent),
      intentHash: record.intent.intentHash,
      purpose: record.intent.policy.purpose,
      status: intentStatus(record.intent),
      mode: record.intent.mode,
      network: record.intent.network,
      createdAt: record.intent.createdAt,
      expiresAt: record.intent.expiresAt,
      anchor: record.intent.anchor,
      executionCount: record.receipts.length,
      allowedCount: record.receipts.filter((r) => r.policyResult === 'ALLOWED').length,
      rejectedCount: record.receipts.filter((r) => r.policyResult === 'REJECTED').length,
      compiler: record.compiler,
    })),
  });
}

/**
 * Commit an approved policy.
 *
 * The policy arrives from the browser, so it is re-validated here against the
 * same schema and the same semantic gate the compiler output went through. A
 * client that edits the policy after review gets a different commitment, and a
 * client that edits it into something unauthorizable gets a 422 — the round trip
 * through the browser is not a way around either gate.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`intents:${clientKey(request)}`, 20, 60_000);
  if (!limit.allowed) {
    return fail(429, `Too many authorizations. Try again in ${limit.retryAfterSeconds}s.`);
  }

  const body = await readJson<unknown>(request);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'The submitted policy does not match the IntentPolicy schema.', {
      stage: 'schema',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }

  const semantics = validatePolicySemantics(parsed.data.policy);
  if (!semantics.ok) {
    return fail(422, 'The submitted policy is structurally valid but cannot be authorized.', {
      stage: 'semantic',
      issues: semantics.errors.map((i) => `${i.field}: ${i.message}`),
    });
  }

  const store = intentStore();
  const { sdk } = runtime();

  try {
    const { intent, anchor } = await sdk.authorize({
      policy: parsed.data.policy,
      sequence: store.nextSequence(),
    });

    if (store.find(intent.intentHash)) {
      return fail(
        409,
        'That exact policy is already authorized. Identical policies produce identical commitments by design — edit the policy or revoke the existing intent.',
      );
    }

    const record = store.create({
      intent,
      receipts: [],
      compiler: parsed.data.compiler ?? {
        compilerId: 'unknown',
        kind: 'deterministic',
        model: null,
        isModelGenerated: false,
        createdAt: intent.createdAt,
        durationMs: 0,
      },
      warnings: parsed.data.warnings,
      sourceText: parsed.data.sourceText,
    });

    return ok({
      intent: record.intent,
      displayNumber: intentDisplayNumber(record.intent),
      anchor,
    });
  } catch (error) {
    return fail(502, `Could not register the intent: ${(error as Error).message}`);
  }
}
