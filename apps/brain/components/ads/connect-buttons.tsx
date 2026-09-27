'use client';

import { useState } from 'react';
import { ADS_CONNECT_NO_CLIENT, ADS_CONNECT_PENDING } from '@/lib/ads-copy';

export function ConnectButtons({
  clientId,
  allowMeta = true,
  allowGoogle = true,
  addMore = false,
}: {
  clientId?: string;
  allowMeta?: boolean;
  allowGoogle?: boolean;
  /** Accounts are already connected; offer adding more instead of a first connect. */
  addMore?: boolean;
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
      setNotice(`Connecting ${platform === 'meta' ? 'Meta' : 'Google Ads'} is turned off for this workspace.`);
      return;
    }
    setBusy(platform);
    setNotice(`Opening ${platform === 'meta' ? 'Meta' : 'Google'} to sign in…`);
    window.location.href = `/api/ads/connect?platform=${platform}&clientId=${encodeURIComponent(clientId)}`;
  }

  const metaLabel = addMore ? 'Add Meta accounts' : 'Connect Meta';
  const googleLabel = addMore ? 'Add Google Ads accounts' : 'Connect Google Ads';

  return (
    <>
      <div className="cx-actions">
        {allowMeta ? (
          <button type="button" className={addMore ? 'btn-secondary' : 'btn-cta'} disabled={busy !== null} onClick={() => start('meta')}>
            {busy === 'meta' ? ADS_CONNECT_PENDING : metaLabel}
          </button>
        ) : (
          <span className="btn-secondary" aria-disabled="true">Meta is turned off</span>
        )}
        {allowGoogle ? (
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => start('google')}>
            {busy === 'google' ? ADS_CONNECT_PENDING : googleLabel}
          </button>
        ) : (
          <span className="btn-secondary" aria-disabled="true">Google Ads is turned off</span>
        )}
      </div>
      {notice ? <p className="cx-banner" role="status">{notice}</p> : null}
    </>
  );
}
