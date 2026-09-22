import Link from 'next/link';

export function AdsModulePlaceholder({
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
        <p className="cx-help">This module is on, but there is no extra workspace here yet.</p>
        <div className="cx-actions">
          <Link href="/ads" className="btn-cta">Back to Ads</Link>
          <Link href="/settings#modules" className="btn-secondary">Settings → Modules</Link>
        </div>
      </section>
    </div>
  );
}
