'use client';

import { useState } from 'react';
import { ADS_CONNECT_NO_CLIENT, ADS_CONNECT_PENDING } from '@/lib/ads-copy';

export function ConnectButtons({
  clientId,
  allowMeta = true,
  allowGoogle = true,
}: {
  clientId?: string;
  allowMeta?: boolean;
  allowGoogle?: boolean;
}) {
  const [busy, setBusy] = useState<'meta' | 'google' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function start(platform: 'meta' | 'google') {
    if (busy) {
      setNotice(ADS_CONNECT_PENDING);
      return;
    }
    if (!clientId) {
      setNotice(ADS_CONNECT_NO_CLIENT);
      return;
    }
    if ((platform === 'meta' && !allowMeta) || (platform === 'google' && !allowGoogle)) {
      setNotice(`${platform === 'meta' ? 'Meta' : 'Google'} connect is off for this workspace.`);
      return;
    }
    setBusy(platform);
    setNotice(`Starting ${platform === 'meta' ? 'Meta' : 'Google'} connect…`);
    window.location.href = `/api/ads/connect?platform=${platform}&clientId=${encodeURIComponent(clientId)}`;
  }

  return (
    <>
      <div className="cx-actions">
        {allowMeta ? (
          <button type="button" className="btn-cta" disabled={busy !== null} onClick={() => start('meta')}>
            {busy === 'meta' ? ADS_CONNECT_PENDING : 'Connect Meta'}
          </button>
        ) : (
          <span className="btn-secondary" aria-disabled="true">Meta connect is off</span>
        )}
        {allowGoogle ? (
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => start('google')}>
            {busy === 'google' ? ADS_CONNECT_PENDING : 'Connect Google'}
          </button>
        ) : (
          <span className="btn-secondary" aria-disabled="true">Google connect is off</span>
        )}
      </div>
      {notice ? <p className="cx-banner" role="status">{notice}</p> : null}
    </>
  );
}
