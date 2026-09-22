'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { auditStatusLabel } from '@/lib/ads-copy';

export function CheckAdsButton({
  clientId,
  adAccountId,
  disabledReason,
}: {
  clientId?: string;
  adAccountId?: string;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runCheck() {
    if (!clientId || busy) return;
    setBusy(true);
    setMessage('Starting check…');
    try {
      const res = await fetch('/api/ads/checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, adAccountId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        audit?: { id: string; status: string };
      };
      if (!res.ok || !body.audit) {
        setMessage(body.error ?? 'Could not start the check.');
        return;
      }
      setMessage(auditStatusLabel(body.audit.status));
      router.push(`/ads/audits/${body.audit.id}`);
      router.refresh();
    } catch {
      setMessage('Could not start the check.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-actions">
      <button
        type="button"
        className="btn-cta"
        onClick={runCheck}
        disabled={busy || !clientId || Boolean(disabledReason)}
      >
        {busy ? 'Checking…' : 'Check ads'}
      </button>
      {disabledReason ? <p className="cx-help">{disabledReason}</p> : null}
      {message ? <p className="cx-help" role="status">{message}</p> : null}
    </div>
  );
}
