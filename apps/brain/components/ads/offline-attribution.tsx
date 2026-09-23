import type { AdsClient } from '@/lib/ads-bff';

export type OfflineJoin = {
  callId: string;
  sentence: string;
  campaignName?: string;
  matchedOn: string;
  answered: boolean;
  conversion: boolean;
  bookedJobLabel?: string;
};

export type OfflineAttributionView = {
  visible: boolean;
  source?: "callrail" | "bundled" | null;
  callrail: {
    connected: boolean;
    mock: boolean;
    callCount: number;
    lastPulledAt: string | null;
    lastError: string | null;
  };
  bundled?: {
    connected: boolean;
    mock: boolean;
    trackingNumber?: string | null;
    callCount: number;
    lastPulledAt?: string | null;
    lastError?: string | null;
  };
  crm: {
    connected: boolean;
    mock: boolean;
    bookedJobCount: number;
  };
  sentences: string[];
  joins: OfflineJoin[];
  writes: false;
};

export function OfflineAttribution({
  client,
  view,
}: {
  client: AdsClient | null;
  view: OfflineAttributionView | null;
}) {
  if (!view?.visible) return null;

  return (
    <section className="cx-panel">
      <h2>Calls and booked jobs</h2>
      <p className="cx-help">
        {client ? `${client.name}: ` : null}
        Calls join to campaigns in plain language. Nothing is written to CallRail, Twilio, or the CRM from here.
      </p>
      {view.callrail.connected ? (
        <p className="cx-help">
          CallRail is connected{view.callrail.mock ? " (mock)" : ""}.
          {view.callrail.lastPulledAt ? ` Last pull ${new Date(view.callrail.lastPulledAt).toLocaleString()}.` : ""}
        </p>
      ) : view.bundled?.connected ? (
        <p className="cx-help">
          Bundled call tracking is on{view.bundled.mock ? " (mock)" : ""}.
          {view.bundled.trackingNumber ? ` Tracking number ${view.bundled.trackingNumber}.` : ""}
          {view.bundled.lastPulledAt ? ` Last pull ${new Date(view.bundled.lastPulledAt).toLocaleString()}.` : ""}
        </p>
      ) : (
        <p className="cx-help">No call tracker is connected yet. Use Settings → Connect for CallRail or bundled.</p>
      )}
      {view.crm.connected ? (
        <p className="cx-help">Housecall Pro is mock-joined for booked-job status. Deep write-backs stay off.</p>
      ) : null}
      {view.callrail.lastError ? <p className="cx-banner cx-banner-warn">{view.callrail.lastError}</p> : null}
      {view.bundled?.lastError ? <p className="cx-banner cx-banner-warn">{view.bundled.lastError}</p> : null}
      {view.sentences.length > 0 ? (
        <ul className="cx-help">
          {view.sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      ) : (
        <p className="cx-help">Pull calls after connect to see joins.</p>
      )}
      {view.joins.length > 0 ? (
        <details className="cx-details">
          <summary>Details</summary>
          <ul>
            {view.joins.map((join) => (
              <li key={join.callId}>{join.sentence}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
