import type { AdsClient } from '@/lib/ads-bff';
import { formatMoney } from '@/lib/ads-copy';

export type WeeklyNarrativeView = {
  headline: string;
  paragraphs: string[];
  wins: string[];
  risks: string[];
  next: string[];
  metrics: {
    spend7dUsd: string;
    spend30dUsd: string;
    leads7d: number;
    leads30d: number;
    campaignCount: number;
    wasteSpend7dUsd: string;
    wasteCampaigns: string[];
    winnerName: string | null;
    loserName?: string | null;
    callsAnswered: number | null;
    bookedJobs: number | null;
    newLeads: number | null;
    weekOf: string;
  };
  grounded: true;
  writes: false;
};

export function OwnerWeeklyNarrative({
  client,
  view,
}: {
  client: AdsClient | null;
  view: WeeklyNarrativeView | null;
}) {
  if (!view) return null;
  const spend7 = formatMoney(view.metrics.spend7dUsd);
  const spend30 = formatMoney(view.metrics.spend30dUsd);
  const waste = formatMoney(view.metrics.wasteSpend7dUsd);

  return (
    <section className="cx-panel">
      <h2>Owner weekly brief</h2>
      <p className="cx-help">
        {client ? `${client.name}: ` : null}
        In-app digest only. No new email. Every line is grounded in synced numbers.
      </p>
      <p className="cx-stat-text">{view.headline}</p>
      {view.paragraphs.map((line) => (
        <p key={line} className="cx-help">{line}</p>
      ))}
      {view.wins.length > 0 ? (
        <p className="cx-help"><strong>Wins:</strong> {view.wins.join(" ")}</p>
      ) : null}
      {view.risks.length > 0 ? (
        <p className="cx-help"><strong>Risks:</strong> {view.risks.join(" ")}</p>
      ) : null}
      {view.next.length > 0 ? (
        <p className="cx-help"><strong>Next:</strong> {view.next.join(" ")}</p>
      ) : null}
      <details className="cx-details">
        <summary>Details</summary>
        <ul>
          <li>Week of {view.metrics.weekOf}</li>
          {spend7 ? <li>Spend (7 days): {spend7}</li> : null}
          {spend30 ? <li>Spend (30 days): {spend30}</li> : null}
          <li>Leads (7 days): {view.metrics.leads7d}</li>
          <li>Leads (30 days): {view.metrics.leads30d}</li>
          <li>Campaigns: {view.metrics.campaignCount}</li>
          {waste ? <li>Waste this week: {waste}</li> : null}
          {view.metrics.wasteCampaigns.length > 0 ? (
            <li>Waste campaigns: {view.metrics.wasteCampaigns.join(", ")}</li>
          ) : null}
          {view.metrics.winnerName ? <li>Stronger campaign: {view.metrics.winnerName}</li> : null}
          {view.metrics.loserName ? <li>Weaker campaign: {view.metrics.loserName}</li> : null}
          {view.metrics.callsAnswered != null ? <li>Answered calls: {view.metrics.callsAnswered}</li> : null}
          {view.metrics.bookedJobs != null ? <li>Booked jobs: {view.metrics.bookedJobs}</li> : null}
          {view.metrics.newLeads != null ? <li>CRM leads: {view.metrics.newLeads}</li> : null}
          <li>Read-only unless you Approve a recommended action on the inbox card.</li>
        </ul>
      </details>
    </section>
  );
}
