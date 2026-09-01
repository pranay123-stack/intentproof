import { intentDisplayNumber, intentStatus } from '@intentproof/sdk';
import { fail, ok } from '@/lib/api';
import { intentStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = intentStore().find(id);
  if (!record) return fail(404, `No intent matches "${id}".`);

  return ok({
    intent: record.intent,
    displayNumber: intentDisplayNumber(record.intent),
    status: intentStatus(record.intent),
    receipts: record.receipts,
    compiler: record.compiler,
    warnings: record.warnings,
    sourceText: record.sourceText,
  });
}
