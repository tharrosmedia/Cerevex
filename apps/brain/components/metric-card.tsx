import Link from 'next/link';
import type { ReactNode } from 'react';

export function MetricCard({
  href,
  label,
  value,
  hint,
}: {
  href?: string;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  const inner = (
    <>
      <div className="cx-card-kicker">{label}</div>
      <p className={typeof value === 'number' ? 'cx-stat' : 'cx-stat cx-stat-text'}>
        {value}
      </p>
      {hint ? <p className="cx-help">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="cx-card cx-card-linkable">
        {inner}
      </Link>
    );
  }

  return <article className="cx-card">{inner}</article>;
}
