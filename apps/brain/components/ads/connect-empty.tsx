import Link from 'next/link';
import { ConnectButtons } from '@/components/ads/connect-buttons';

export function ConnectEmpty({
  title,
  body,
  clientId,
  showCheckHint,
  allowMeta = true,
  allowGoogle = true,
}: {
  title: string;
  body: string;
  clientId?: string;
  showCheckHint?: boolean;
  allowMeta?: boolean;
  allowGoogle?: boolean;
}) {
  return (
    <section className="cx-panel">
      <h2 className="cx-card-title">{title}</h2>
      <p className="cx-help">{body}</p>
      <ConnectButtons clientId={clientId} allowMeta={allowMeta} allowGoogle={allowGoogle} />
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
