import Link from 'next/link';
import type { ReactNode } from 'react';
import { GSC_POSITION_EDUCATION_SHORT, GSC_REC_TYPE_HELP, gscRecTypeLabel } from '@/src/lib/seo/gsc-copy';
import { isGscRecKind } from '@/src/lib/seo/gsc-recommendations';

export function GscRecommendationCard({
  finding,
  applyWritable,
  actions,
}: {
  finding: any;
  applyWritable: boolean;
  actions?: ReactNode;
}) {
  const kind = finding.kind as string;
  const detail = finding.detail || {};
  const why = detail.why || finding.title;
  const discrepancy = detail.discrepancy || null;
  const queries: string[] = detail.queries || (detail.query ? [detail.query] : []);
  const pages: string[] = detail.pages || (detail.page ? [detail.page] : []);
  const help = isGscRecKind(kind) ? GSC_REC_TYPE_HELP[kind] : GSC_POSITION_EDUCATION_SHORT;

  return (
    <article className="cx-card">
      <div className="cx-card-kicker">
        <span>{gscRecTypeLabel(kind)}</span>
        {finding.severity ? <span>{finding.severity}</span> : null}
        {!applyWritable ? <span>Recommend only</span> : null}
      </div>
      <h3 className="cx-card-title">{gscRecTypeLabel(kind)}</h3>
      <p className="cx-card-why">{why}</p>
      {discrepancy && discrepancy !== why ? <p className="cx-card-why">{discrepancy}</p> : null}
      {detail.offerIntent ? <p className="cx-card-meta">{detail.offerIntent}</p> : null}
      <details className="cx-details">
        <summary>Details</summary>
        <p>{help}</p>
        <p>{GSC_POSITION_EDUCATION_SHORT}</p>
        {discrepancy ? <p>{discrepancy}</p> : null}
        <ul>
          {queries.length ? <li>Searches: {queries.join(', ')}</li> : null}
          {pages.length ? <li>Pages: {pages.join(', ')}</li> : null}
          {detail.impressions != null ? <li>Impressions: {detail.impressions}</li> : null}
          {detail.clicks != null ? <li>Clicks: {detail.clicks}</li> : null}
          {detail.ctr != null ? <li>Click rate: {(Number(detail.ctr) * 100).toFixed(1)}%</li> : null}
          {detail.position != null ? <li>Average place: {Number(detail.position).toFixed(1)}</li> : null}
          {detail.threshold != null ? <li>Your cutoff: worse than {Number(detail.threshold).toFixed(1)}</li> : null}
          {detail.keeperUrl ? <li>Keep: {detail.keeperUrl}</li> : null}
          {Array.isArray(detail.croSignals) && detail.croSignals.length ? (
            <li>Why this is worth doing: {detail.croSignals.join('; ')}</li>
          ) : null}
        </ul>
      </details>
      {actions ? <div className="cx-actions">{actions}</div> : null}
    </article>
  );
}

export function GscCatalogFindingCard({
  finding,
  actions,
}: {
  finding: any;
  actions?: ReactNode;
}) {
  return (
    <article className="cx-card">
      <div className="cx-card-kicker">
        <span>{finding.kind}</span>
        {finding.severity ? <span>{finding.severity}</span> : null}
      </div>
      <h3 className="cx-card-title">{finding.title}</h3>
      <p className="cx-card-meta">{[finding.resourceType, finding.handle].filter(Boolean).join(' ') || '—'}</p>
      <details className="cx-details">
        <summary>Details</summary>
        {finding.detail?.query ? <p>Search: {finding.detail.query}</p> : <p>Catalog check.</p>}
      </details>
      {finding.kind === 'content_gap' && finding.detail?.query ? (
        <Link href={`/seo/create?keyword=${encodeURIComponent(finding.detail.query)}`} className="cx-card-link">
          Create
        </Link>
      ) : null}
      {actions ? <div className="cx-actions">{actions}</div> : null}
    </article>
  );
}
