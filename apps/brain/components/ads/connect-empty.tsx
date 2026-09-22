import Link from 'next/link';

export function ConnectEmpty({
  title,
  body,
  clientId,
  showCheckHint,
}: {
  title: string;
  body: string;
  clientId?: string;
  showCheckHint?: boolean;
}) {
  const metaHref = clientId
    ? `/api/ads/connect?platform=meta&clientId=${encodeURIComponent(clientId)}`
    : undefined;
  const googleHref = clientId
    ? `/api/ads/connect?platform=google&clientId=${encodeURIComponent(clientId)}`
    : undefined;

  return (
    <section className="cx-panel">
      <h2 className="cx-card-title">{title}</h2>
      <p className="cx-help">{body}</p>
      <div className="cx-actions">
        {metaHref ? (
          <a className="btn-cta" href={metaHref}>Connect Meta</a>
        ) : (
          <span className="btn-cta" aria-disabled="true">Connect Meta</span>
        )}
        {googleHref ? (
          <a className="btn-secondary" href={googleHref}>Connect Google</a>
        ) : (
          <span className="btn-secondary" aria-disabled="true">Connect Google</span>
        )}
      </div>
      {!clientId ? (
        <p className="cx-help">Choose a client first, or add one in Ads settings when that is ready.</p>
      ) : null}
      {showCheckHint ? (
        <p className="cx-help">
          After an account is connected, come back here and choose <strong>Check ads</strong>.
        </p>
      ) : null}
      <p className="cx-help">
        Need modules instead? <Link href="/settings#modules">Settings → Modules</Link>
      </p>
    </section>
  );
}
