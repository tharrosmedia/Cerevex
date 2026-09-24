'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FunnelConnectForm({
  clientId,
  canWrite,
}: {
  clientId?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState('');
  const [measurementId, setMeasurementId] = useState('');

  async function connect(connectorId: 'ga4' | 'first_party') {
    if (busy) {
      setError('Still saving the last connect.');
      return;
    }
    if (!canWrite) {
      setError('Funnel connect is recommend-only or off. Nothing new will be stored.');
      return;
    }
    if (!clientId) {
      setError('Choose a client first, then connect.');
      return;
    }
    setBusy(connectorId);
    setError(null);
    try {
      const res = await fetch('/api/ads/m51', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'funnel_connect',
          clientId,
          connectorId,
          propertyId: propertyId || undefined,
          measurementId: measurementId || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not connect that source.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect that source.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cx-panel">
      <h2>Connect funnel data</h2>
      <p className="cx-help">
        Add Google Analytics (GA4) and/or the Cerevex pixel. We count page visits and leads only — no recordings, heatmaps, or visitor video.
      </p>
      <label>
        GA4 property id
        <input value={propertyId} onChange={(event) => setPropertyId(event.target.value)} placeholder="properties/123456789" />
      </label>
      <label>
        GA4 measurement id (optional)
        <input value={measurementId} onChange={(event) => setMeasurementId(event.target.value)} placeholder="G-XXXX" />
      </label>
      <div className="cx-actions">
        <button type="button" className="btn-cta" disabled={busy !== null} onClick={() => connect('ga4')}>
          {busy === 'ga4' ? 'Saving…' : 'Connect GA4'}
        </button>
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => connect('first_party')}>
          {busy === 'first_party' ? 'Saving…' : 'Turn on Cerevex pixel'}
        </button>
      </div>
      {!canWrite ? <p className="cx-help">Funnel connect is recommend-only or off. Nothing new will be stored.</p> : null}
      {error ? <p className="cx-banner cx-banner-warn" role="alert">{error}</p> : null}
    </div>
  );
}
