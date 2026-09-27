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
      <div className="cx-actions">
        <Link href="/ads" className="btn-cta">Back to Ads</Link>
      </div>
    </div>
  );
}
