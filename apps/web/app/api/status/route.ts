import { runtimeStatus } from '@/lib/server';
import { intentStore } from '@/lib/store';
import { ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** What this deployment can actually do. Read by the UI, never cached. */
export function GET() {
  const status = runtimeStatus();
  return ok({
    ...status,
    store: {
      persistent: intentStore().persistent,
      intentCount: intentStore().list().length,
    },
  });
}
