import Link from 'next/link';
import {
  formatMoney,
  metricLines,
  platformFromRecord,
  platformLabel,
  riskLabel,
  suggestionLabel,
  suggestionStatusLabel,
  suggestionWhy,
} from '@/lib/ads-copy';
import type { AdsSuggestion } from '@/lib/ads-bff';

export function RecommendationCard({
  suggestion,
  clientName,
  href,
}: {
  suggestion: AdsSuggestion;
  clientName?: string;
  href?: string;
}) {
  const title = suggestionLabel(suggestion.type, suggestion.title);
  const impact = formatMoney(suggestion.estimatedImpactUsd);
  const risk = riskLabel(suggestion.risk);
  const platform = platformLabel(platformFromRecord(suggestion.evidence));
  const details = metricLines(suggestion.evidence);
  const inner = (
    <>
      <div className="cx-card-kicker">
        {clientName ? <span>{clientName}</span> : null}
        {platform ? <span>{platform}</span> : null}
        <span>{suggestionStatusLabel(suggestion.status)}</span>
      </div>
      <h3 className="cx-card-title">{title}</h3>
      <p className="cx-card-why">{suggestionWhy(suggestion.type, suggestion.rationale)}</p>
      <p className="cx-card-meta">
        {impact ? <strong>Est. {impact}</strong> : null}
        {impact && risk ? ' · ' : null}
        {risk || null}
      </p>
      <details className="cx-details">
        <summary>Details</summary>
        {suggestion.rationale ? <p>{suggestion.rationale}</p> : null}
        {details.length > 0 ? (
          <ul>
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>No extra numbers for this suggestion.</p>
        )}
      </details>
    </>
  );

  if (href) {
    return (
      <article className="cx-card">
        {inner}
        <Link href={href} className="cx-card-link">Open suggestion</Link>
      </article>
    );
  }

  return <article className="cx-card">{inner}</article>;
}
