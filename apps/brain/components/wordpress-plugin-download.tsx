'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  pluginDownloadError,
  WORDPRESS_PLUGIN_DRIVE_LABEL,
  WORDPRESS_PLUGIN_DRIVE_URL,
} from '@/src/lib/wordpress/plugin-download';

export function WordpressPluginDownload({ trailing = null }: { trailing?: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onDownload(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/wordpress/plugin', { cache: 'no-store' });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || type.includes('json') || type.startsWith('text/')) {
        setError(await pluginDownloadError(response));
        return;
      }
      const blob = await response.blob();
      if (blob.size < 22) {
        setError(await pluginDownloadError(new Response(null, { status: 503 })));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cerevex-wordpress.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('The in-app download failed. Use Download plugin zip.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="cx-plugin-downloads">
        <a className="btn-secondary" href={WORDPRESS_PLUGIN_DRIVE_URL} target="_blank" rel="noopener noreferrer">
          {WORDPRESS_PLUGIN_DRIVE_LABEL}
        </a>
        <a href="/api/wordpress/plugin" onClick={onDownload} aria-busy={pending}>
          {pending ? 'Preparing download…' : 'In-app download'}
        </a>
        {trailing}
      </div>
      {error ? <p className="cx-banner cx-banner-warn" role="alert">{error}</p> : null}
    </>
  );
}
