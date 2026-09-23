import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  kicker,
  title,
  lede,
  backHref,
  backLabel = '← Overview',
  actions,
}: {
  kicker?: string;
  title: string;
  lede?: string;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="cx-page-head">
      {backHref ? (
        <Link href={backHref} className="cx-back">
          {backLabel}
        </Link>
      ) : null}
      <div className="cx-section-head">
        <div>
          {kicker ? <p className="cx-kicker">{kicker}</p> : null}
          <h1>{title}</h1>
          {lede ? <p className="cx-lede">{lede}</p> : null}
        </div>
        {actions ? <div className="cx-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
