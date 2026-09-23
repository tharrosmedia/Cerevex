import type { AdsClient } from '@/lib/ads-bff';

export type LpSignalView = {
  kind: string;
  metric: string;
  value: number;
  pageUrl?: string;
  pageLabel?: string;
  why: string;
  details?: Record<string, number | string>;
};

export type LpIntelligenceView = {
  visible: boolean;
  clarity: {
    connected: boolean;
    mock: boolean;
    projectId: string | null;
    lastPulledAt: string | null;
    lastError: string | null;
    sessionCount: number;
    signalCount: number;
    signals: LpSignalView[];
  };
  siteApply: "later" | "ready";
  siteSupportsMutation: boolean;
  capture: false;
  writes: false;
};

const KIND_LABEL: Record<string, string> = {
  hero: "Hero",
  structure: "Structure",
  copy: "Copy",
  wizard: "Wizard",
};

export function LpIntelligence({
  client,
  view,
}: {
  client: AdsClient | null;
  view: LpIntelligenceView | null;
}) {
  if (!view?.visible) return null;

  return (
    <section className="cx-panel">
      <h2>Landing-page intelligence</h2>
      <p className="cx-help">
        {client ? `${client.name}: ` : null}
        Aggregated Clarity session signals only. Cerevex does not record sessions or build a heatmap in-house.
      </p>
      {view.clarity.connected ? (
        <p className="cx-help">
          Clarity is connected{view.clarity.mock ? " (mock)" : ""}.
          {view.clarity.lastPulledAt ? ` Last pull ${new Date(view.clarity.lastPulledAt).toLocaleString()}.` : ""}
          {view.clarity.sessionCount ? ` ${view.clarity.sessionCount} sessions in the summary.` : ""}
        </p>
      ) : (
        <p className="cx-help">Clarity is not connected yet. Use Settings → Connect Clarity.</p>
      )}
      {view.siteApply === "later" ? (
        <p className="cx-help">Site apply later — Cerevex cannot change the website in this slice.</p>
      ) : null}
      {view.clarity.lastError ? <p className="cx-banner cx-banner-warn">{view.clarity.lastError}</p> : null}
      {view.clarity.signals.length > 0 ? (
        <ul className="cx-help">
          {view.clarity.signals.map((signal) => (
            <li key={`${signal.kind}-${signal.metric}`}>{signal.why}</li>
          ))}
        </ul>
      ) : (
        <p className="cx-help">Pull session signals after connect, then run a check to see hero / structure / copy / wizard recs.</p>
      )}
      {view.clarity.signals.length > 0 ? (
        <details className="cx-details">
          <summary>Details</summary>
          <ul>
            {view.clarity.signals.map((signal) => (
              <li key={`${signal.kind}-details`}>
                {KIND_LABEL[signal.kind] ?? signal.kind}: {signal.metric} = {signal.value}
                {signal.pageUrl ? ` · ${signal.pageUrl}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
