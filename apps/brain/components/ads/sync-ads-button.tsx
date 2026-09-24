'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ADS_SYNC_NO_ACCOUNT, ADS_SYNC_PENDING, ADS_SYNC_QUEUED } from '@/lib/ads-copy';

export function SyncAdsButton({
  accountIds,
  disabledReason,
}: {
  accountIds: string[];
  disabledReason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    if (busy) {
      setMessage(ADS_SYNC_PENDING);
      return;
    }
    if (disabledReason) {
      setMessage(disabledReason);
      return;
    }
    if (accountIds.length === 0) {
      setMessage(ADS_SYNC_NO_ACCOUNT);
      return;
    }
    setBusy(true);
    setMessage(ADS_SYNC_PENDING);
    try {
      const res = await fetch('/api/ads/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountIds }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; queued?: number };
      if (!res.ok) {
        setMessage(body.error ?? 'Could not queue sync.');
        return;
      }
      setMessage(ADS_SYNC_QUEUED);
      router.refresh();
    } catch {
      setMessage('Could not queue sync.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-actions">
      <button
        type="button"
        className="btn-secondary"
        onClick={sync}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? ADS_SYNC_PENDING : 'Sync accounts'}
      </button>
      {disabledReason ? <p className="cx-help">{disabledReason}</p> : null}
      {message ? <p className="cx-help" role="status">{message}</p> : null}
    </div>
  );
}
