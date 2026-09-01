'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonClass } from './ui';

/**
 * The two things a user can still do to a live intent.
 *
 * Revocation is destructive and irreversible, so it asks first. Running the
 * agent is not, so it does not.
 */
export function IntentActions({
  intentId,
  revoked,
  expired,
}: {
  intentId: string;
  revoked: boolean;
  expired: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const post = async (path: string, body: unknown, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Request failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || revoked || expired}
          onClick={() => post(`/api/intents/${intentId}/run`, { strategy: 'scenario' }, 'run')}
          className={buttonClass.primary}
        >
          {busy === 'run' ? 'Running…' : 'Run scripted scenario'}
        </button>
        <button
          type="button"
          disabled={busy !== null || revoked || expired}
          onClick={() =>
            post(
              `/api/intents/${intentId}/run`,
              { strategy: 'drifting', steps: 6, seed: Math.floor(Math.random() * 100_000) },
              'drift',
            )
          }
          className={buttonClass.secondary}
        >
          {busy === 'drift' ? 'Running…' : 'Run drifting agent'}
        </button>

        {revoked ? null : confirming ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post(`/api/intents/${intentId}/revoke`, {}, 'revoke')}
              className={buttonClass.danger}
            >
              {busy === 'revoke' ? 'Revoking…' : 'Confirm revoke'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass.ghost}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={buttonClass.danger}>
            Revoke intent
          </button>
        )}
      </div>

      {confirming ? (
        <p className="text-[12.5px] leading-relaxed text-warn">
          Revoking is permanent. The agent stops being authorized immediately, and every receipt
          recorded after this moment will fail verification.
        </p>
      ) : null}
      {error ? (
        <p className="text-[12.5px] text-reject" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
