import Link from 'next/link';
import { findingLabel, metricLines, platformFromRecord, platformLabel, ruleIdFromBody, titleCase } from '@/lib/ads-copy';
import type { AdsFinding } from '@/lib/ads-bff';

const SEVERITY: Record<string, string> = {
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export function FindingCard({
  finding,
  href,
}: {
  finding: AdsFinding;
  href?: string;
}) {
  const ruleId = ruleIdFromBody(finding.body);
  const title = findingLabel(ruleId, finding.title);
  const platform = platformLabel(platformFromRecord(finding.body));
  const details = metricLines(finding.body);
  const severity = SEVERITY[finding.severity] ?? titleCase(finding.severity);

  return (
    <article className="cx-card">
      <div className="cx-card-kicker">
        <span>{severity}</span>
        {platform ? <span>{platform}</span> : null}
      </div>
      <h3 className="cx-card-title">{title}</h3>
      {finding.title && finding.title !== title ? <p className="cx-card-why">{finding.title}</p> : null}
      <details className="cx-details">
        <summary>Details</summary>
        {details.length > 0 ? (
          <ul>
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>No extra numbers for this finding.</p>
        )}
      </details>
      {href ? <Link href={href} className="cx-card-link">Open finding</Link> : null}
    </article>
  );
}
