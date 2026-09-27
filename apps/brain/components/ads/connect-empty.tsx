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
        <p className="cx-help">
          <Link href="/stores">Add a store or site</Link> first. Each site connects its own ad accounts.
        </p>
      ) : null}
      {showCheckHint ? (
        <p className="cx-help">
          After an account is connected, come back here and choose <strong>Check ads</strong>.
        </p>
      ) : null}
    </section>
  );
}
