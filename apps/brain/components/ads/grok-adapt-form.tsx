'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function GrokAdaptForm({
  clientId,
  entityId,
  sourcePlatform,
  canGenerate,
}: {
  clientId: string;
  entityId: string;
  sourcePlatform: string;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const target = sourcePlatform === 'meta' ? 'google' : 'meta';

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ads/m51', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'generate', clientId, entityId, targetPlatform: target }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not generate an alternative.');
      setNotice('Grok saved an alternative. Open Leads to Promote it. Nothing was written to ads.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate an alternative.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-actions">
      <button type="button" className="btn-cta" disabled={!canGenerate || busy} onClick={() => generate()}>
        {busy ? 'Making another…' : `Adapt / make another for ${target === 'google' ? 'Google' : 'Meta'}?`}
      </button>
      {!canGenerate ? (
        <p className="cx-help">Grok creatives are recommend-only or off. Nothing will generate.</p>
      ) : (
        <p className="cx-help">Grok never writes live ads. Promote, then Approve.</p>
      )}
      {notice ? <p className="cx-banner" role="status">{notice}</p> : null}
      {error ? <p className="cx-banner cx-banner-warn" role="alert">{error}</p> : null}
    </div>
  );
}
