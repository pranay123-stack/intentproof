import { intentStatus } from '@intentproof/sdk';
import { fail, ok } from '@/lib/api';
import { runtime } from '@/lib/server';
import { intentStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Revocation is the user's escape hatch and it takes effect immediately.
 *
 * The local record is updated whether or not a chain write succeeds: an intent
 * the user has told us to stop honouring must stop being honoured now, not after
 * a transaction confirms. If the chain write does happen, the anchor is attached
 * so the revocation is independently checkable too.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = intentStore();
  const record = store.find(id);
  if (!record) return fail(404, `No intent matches "${id}".`);
  if (record.intent.revokedAt) return fail(409, 'That intent is already revoked.');

  const { sdk } = runtime();
  let anchor = null;
  let chainError: string | null = null;
  try {
    anchor = await sdk.revoke(record.intent);
  } catch (error) {
    chainError = (error as Error).message;
  }

  const updated = store.update(record.intent.intentId, (r) => {
    r.intent = { ...r.intent, revokedAt: new Date().toISOString(), revocationAnchor: anchor };
  });

  return ok({
    intent: updated?.intent,
    status: updated ? intentStatus(updated.intent) : 'REVOKED',
    anchor,
    chainError,
  });
}
