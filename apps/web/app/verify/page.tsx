import type { Metadata } from 'next';
import { VerifyConsole } from '@/components/verify-console';
import { PageHeader } from '@/components/ui';
import { performVerification } from '@/lib/verify-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify',
  description:
    'Check an execution receipt against the intent it claims to satisfy. Every hash is recomputed and the policy engine is re-run.',
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string): string => {
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  };

  const intentHash = single('intentHash');
  const receiptHash = single('receiptHash');

  // A link from an intent page already names what to check, so the answer is
  // computed here rather than after a round trip from the browser.
  const preloaded =
    intentHash || receiptHash
      ? await performVerification({
          ...(intentHash ? { intentHash } : {}),
          ...(receiptHash ? { receiptHash } : {}),
        })
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Verification"
        title="Check the record yourself"
        lede={
          <>
            Verification recomputes the intent commitment from the policy, recomputes the receipt
            hash from the receipt, and re-runs the deterministic policy engine at the timestamp the
            receipt claims. If any of those disagree, the page names the rule that failed.
          </>
        }
      />

      <div className="mx-auto max-w-4xl px-5 py-10">
        <VerifyConsole
          initialIntentHash={intentHash}
          initialReceiptHash={receiptHash}
          initialResult={preloaded?.ok ? preloaded.payload : null}
          initialError={preloaded && !preloaded.ok ? preloaded.error : null}
        />
      </div>
    </>
  );
}
