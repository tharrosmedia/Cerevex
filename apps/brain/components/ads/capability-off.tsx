import Link from 'next/link';

export function AdsCapabilityOff({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>{title}</h1>
      <p className="cx-lede">{body}</p>
      <section className="cx-panel">
        <p className="cx-help">
          This capability is off for this workspace. Existing ads data is still readable from the API.
          Flip the workspace flag in Settings — Site Brain does not need a redeploy.
        </p>
        <div className="cx-actions">
          <Link href="/ads" className="btn-cta">Back to Ads</Link>
          <Link href="/settings#capabilities" className="btn-secondary">Settings → Capabilities</Link>
        </div>
      </section>
    </div>
  );
}
