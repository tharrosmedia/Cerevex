/**
 * Lightweight funnel signal from GA4 aggregates and/or first-party events.
 * Strengthens recs when data exists. Not session replay / heatmaps.
 */

export const FUNNEL_EVENT_NAMES = ["page_view", "view_content", "generate_lead", "purchase"] as const;
export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export type FunnelEventView = {
  name: string;
  source: string;
  platform?: string | null;
  campaign?: string | null;
  url?: string | null;
};

export type FunnelSlice = {
  key: string;
  platform: string | null;
  campaign: string | null;
  pageViews: number;
  leads: number;
  purchases: number;
  conversionRate: number | null;
};

export type FunnelSignal = {
  source: "ga4" | "first_party" | "both" | "none";
  eventCount: number;
  slices: FunnelSlice[];
  best?: FunnelSlice | null;
  why: string;
};

function isLead(name: string): boolean {
  return name === "generate_lead" || name === "purchase" || name === "lead";
}

export function summarizeFunnel(events: FunnelEventView[], ga4Connected: boolean): FunnelSignal {
  if (events.length === 0) {
    return {
      source: ga4Connected ? "ga4" : "none",
      eventCount: 0,
      slices: [],
      best: null,
      why: ga4Connected
        ? "GA4 is connected, but no aggregated conversions were pulled yet."
        : "No funnel events yet. Connect GA4 or add the Cerevex pixel.",
    };
  }

  const buckets = new Map<string, FunnelSlice>();
  for (const event of events) {
    const key = `${event.platform ?? "unknown"}::${event.campaign ?? "unknown"}`;
    const current = buckets.get(key) ?? {
      key,
      platform: event.platform ?? null,
      campaign: event.campaign ?? null,
      pageViews: 0,
      leads: 0,
      purchases: 0,
      conversionRate: null,
    };
    if (event.name === "page_view" || event.name === "view_content") current.pageViews += 1;
    if (isLead(event.name)) current.leads += 1;
    if (event.name === "purchase") current.purchases += 1;
    buckets.set(key, current);
  }

  const slices = [...buckets.values()].map((slice) => ({
    ...slice,
    conversionRate: slice.pageViews > 0 ? slice.leads / slice.pageViews : null,
  }));
  const ranked = [...slices].sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1));
  const best = ranked.find((row) => row.pageViews >= 3 && (row.leads > 0 || row.purchases > 0)) ?? null;
  const sources = new Set(events.map((row) => row.source));
  const source: FunnelSignal["source"] = sources.has("ga4") && sources.has("first_party")
    ? "both"
    : sources.has("ga4")
      ? "ga4"
      : "first_party";

  return {
    source,
    eventCount: events.length,
    slices,
    best,
    why: best
      ? `${best.campaign ?? "This campaign"} turns ${best.leads} of ${best.pageViews} page visits into leads${
          best.conversionRate != null ? ` (${(best.conversionRate * 100).toFixed(1)}%)` : ""
        }. That is from ${source === "both" ? "GA4 and the Cerevex pixel" : source === "ga4" ? "GA4" : "the Cerevex pixel"}.`
      : `Counted ${events.length} funnel events. Need a few page visits and at least one lead before this can pick a winner.`,
  };
}

export function funnelStrengthFor(
  signal: FunnelSignal | null | undefined,
  platform?: string | null,
  campaign?: string | null,
): { boosts: boolean; why: string | null } {
  if (!signal || !signal.best) return { boosts: false, why: null };
  const best = signal.best;
  const platformMatch = !platform || !best.platform || best.platform === platform;
  const campaignMatch =
    !campaign ||
    !best.campaign ||
    best.campaign === campaign ||
    best.campaign.toLowerCase().includes(campaign.toLowerCase()) ||
    campaign.toLowerCase().includes(best.campaign.toLowerCase());
  if (platformMatch && campaignMatch) {
    return { boosts: true, why: signal.why };
  }
  return { boosts: false, why: null };
}

export function inferPlatformFromClick(input: {
  gclid?: string | null;
  fbclid?: string | null;
  utmSource?: string | null;
}): "meta" | "google" | null {
  if (input.fbclid) return "meta";
  if (input.gclid) return "google";
  const source = (input.utmSource ?? "").toLowerCase();
  if (source.includes("facebook") || source.includes("instagram") || source.includes("meta")) return "meta";
  if (source.includes("google") || source.includes("adwords")) return "google";
  return null;
}
