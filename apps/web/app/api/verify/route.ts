import { fail, ok, readJson } from '@/lib/api';
import { VerifyRequestSchema, performVerification } from '@/lib/verify-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = VerifyRequestSchema.safeParse((await readJson<unknown>(request)) ?? {});
  if (!parsed.success) {
    return fail(400, 'Provide an intent hash, a receipt hash, or a full receipt.', {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  const result = await performVerification(parsed.data);
  if (!result.ok) return fail(result.status, result.error);
  return ok(result.payload);
}
