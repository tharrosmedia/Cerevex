import type { AdsClient } from '@/lib/ads-bff';

export type SeasonalityWindowView = {
  id: string;
  name: string;
  kind: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  intent: string;
  campaignHint?: string | null;
  offerCopy?: string | null;
  active: boolean;
  upcoming: boolean;
  when: string;
};

export type SeasonalityView = {
  windows: SeasonalityWindowView[];
  active: Array<{ id: string; name: string }>;
  upcoming: Array<{ id: string; name: string }>;
  source: "default" | "workspace";
  updatedAt: string | null;
  writes: false;
};

function intentLabel(intent: string): string {
  if (intent === "ramp") return "Ramp";
  if (intent === "pause") return "Pause";
  if (intent === "shift") return "Shift budget";
  if (intent === "hold") return "Hold spend-up";
  return intent;
}

export function SeasonalityCalendar({
  client,
  view,
}: {
  client: AdsClient | null;
  view: SeasonalityView | null;
}) {
  if (!view) return null;

  return (
    <section className="cx-panel">
      <h2>Seasonality and offers</h2>
      <p className="cx-help">
        {client ? `${client.name}: ` : null}
        Plan seasonal windows here. Live campaign changes still need Approve. Deny and Snooze never write.
      </p>
      <p className="cx-help">
        {view.source === "default" ? "Showing the default HVAC year until you save your own windows in Settings." : "Using the saved workspace calendar."}
      </p>
      {view.windows.length === 0 ? (
        <p className="cx-help">No windows on the calendar yet.</p>
      ) : (
        <ul className="cx-help">
          {view.windows.map((window) => (
            <li key={window.id}>
              <strong>{window.name}</strong> — {window.when}. {intentLabel(window.intent)}
              {window.active ? " · Now" : window.upcoming ? " · Upcoming" : ""}.
              {window.offerCopy ? ` ${window.offerCopy}` : ""}
            </li>
          ))}
        </ul>
      )}
      <details className="cx-details">
        <summary>Details</summary>
        <ul>
          {view.active.length > 0 ? <li>Active: {view.active.map((row) => row.name).join(", ")}</li> : <li>No window is active today.</li>}
          {view.upcoming.length > 0 ? <li>Upcoming: {view.upcoming.map((row) => row.name).join(", ")}</li> : null}
          {view.updatedAt ? <li>Last saved: {new Date(view.updatedAt).toLocaleString()}</li> : <li>Not saved yet — default year.</li>}
          <li>Calendar to campaign coupling is recommend or Approve only.</li>
        </ul>
      </details>
    </section>
  );
}
