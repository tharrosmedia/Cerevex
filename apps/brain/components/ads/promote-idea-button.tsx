'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PromoteIdeaButton({
  clientId,
  ideaId,
  canPromote,
}: {
  clientId: string;
  ideaId: string;
  canPromote: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ads/m51', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'promote', clientId, ideaId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; recommendation?: { id?: string } };
      if (!res.ok) throw new Error(body.error ?? 'Could not promote that idea.');
      const id = body.recommendation?.id;
      router.push(id ? `/ads/suggestions/${id}` : '/ads/suggestions');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not promote that idea.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-cta" disabled={!canPromote || busy} onClick={() => promote()}>
        {busy ? 'Promoting…' : 'Promote to suggestion'}
      </button>
      <p className="cx-help">Promote makes a suggestion. Approve is still required before any live create.</p>
      {error ? <p className="cx-banner cx-banner-warn" role="alert">{error}</p> : null}
    </div>
  );
}
