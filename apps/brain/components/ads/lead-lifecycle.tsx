import type { AdsClient } from '@/lib/ads-bff';

export type LeadLifecycleLead = {
  id: string;
  stage: "lead" | "contacted" | "booked" | string;
  label: string;
  campaignHint?: string;
  updatedAt?: string;
};

export type LeadLifecycleCardView = {
  stage: "lead" | "contacted" | "booked" | string;
  title: string;
  why: string;
  leads: LeadLifecycleLead[];
};

export type LeadLifecycleView = {
  visible: boolean;
  crm: {
    connected: boolean;
    mock: boolean;
    bookedJobCount: number;
    leadCount: number;
    lastPulledAt?: string | null;
    lastError?: string | null;
  };
  sentences: string[];
  cards: LeadLifecycleCardView[];
  leadCount: number;
  contactedCount: number;
  bookedCount: number;
  writes: false;
  crmWrite: "later";
};

const STAGE_ORDER = ["lead", "contacted", "booked"] as const;

export function LeadLifecycle({
  client,
  view,
}: {
  client: AdsClient | null;
  view: LeadLifecycleView | null;
}) {
  if (!view?.visible) return null;
  const cards = STAGE_ORDER.map((stage) => view.cards.find((card) => card.stage === stage) ?? {
    stage,
    title: stage === "lead" ? "New lead" : stage === "contacted" ? "Contacted" : "Booked",
    why: "",
    leads: [],
  });

  return (
    <section className="cx-panel">
      <h2>Lead to booked</h2>
      <p className="cx-help">
        {client ? `${client.name}: ` : null}
        The common path stays here — new lead, contacted, then booked. You do not need to leave Cerevex for this.
      </p>
      {view.crm.connected ? (
        <p className="cx-help">
          Housecall Pro is connected{view.crm.mock ? " (mock)" : ""}.
          {view.crm.lastPulledAt ? ` Last pull ${new Date(view.crm.lastPulledAt).toLocaleString()}.` : ""}
        </p>
      ) : (
        <p className="cx-help">Connect Housecall Pro in Settings to pull leads and booked jobs.</p>
      )}
      <p className="cx-help">CRM apply later — Approve can queue a write, but this slice does not change Housecall Pro.</p>
      {view.crm.lastError ? <p className="cx-banner cx-banner-warn">{view.crm.lastError}</p> : null}
      {view.sentences.length > 0 ? (
        <ul className="cx-help">
          {view.sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      ) : null}
      <div className="cx-card-grid">
        {cards.map((card) => (
          <article key={card.stage} className="cx-card">
            <div className="cx-card-kicker">{card.title}</div>
            <p className="cx-stat">{card.leads.length}</p>
            <p className="cx-card-why">{card.why}</p>
            {card.leads.length > 0 ? (
              <details className="cx-details">
                <summary>Details</summary>
                <ul>
                  {card.leads.map((lead) => (
                    <li key={lead.id}>
                      {lead.label}
                      {lead.campaignHint ? ` · ${lead.campaignHint}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="cx-help">None in this step yet.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
