import { commitPolicy, validatePolicySemantics } from '@intentproof/sdk';
import { CompilationError } from '@intentproof/intent-compiler';
import { z } from 'zod';
import { clientKey, fail, ok, rateLimit, readJson } from '@/lib/api';
import { runtime } from '@/lib/server';

export const runtime_ = 'nodejs';
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  naturalLanguage: z.string().min(10).max(4000),
});

/**
 * Natural language in, a *proposal* out.
 *
 * This route deliberately creates nothing. It returns the policy the compiler
 * drafted plus the commitment that policy *would* produce, so the review screen
 * can show the user the exact hash they are about to authorize. Committing
 * happens in POST /api/intents, after an explicit human action.
 *
 * The OpenAI key is read here, on the server, and never leaves it.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`compile:${clientKey(request)}`, 12, 60_000);
  if (!limit.allowed) {
    return fail(429, `Too many compile requests. Try again in ${limit.retryAfterSeconds}s.`);
  }

  const body = await readJson<unknown>(request);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'Describe the authority you want to grant, in 10 to 4000 characters.', {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  const { compiler, compilerError } = runtime();
  if (!compiler) {
    return fail(503, compilerError ?? 'No intent compiler is configured on this deployment.');
  }

  try {
    const result = await compiler.compile(parsed.data.naturalLanguage);
    const commitment = commitPolicy(result.policy);
    const semantics = validatePolicySemantics(result.policy);

    return ok({
      policy: result.policy,
      proposal: result.proposal,
      provenance: result.provenance,
      warnings: result.warnings,
      advisories: semantics.advisories,
      preview: {
        intentHash: commitment.intentHash,
        canonical: commitment.canonical,
        chunkCount: commitment.chunks.length,
      },
    });
  } catch (error) {
    if (error instanceof CompilationError) {
      return fail(422, error.message, { stage: error.stage, issues: error.issues });
    }
    // Never echo the caller's text or the model's output into an error body.
    return fail(500, 'The intent compiler failed unexpectedly.');
  }
}
