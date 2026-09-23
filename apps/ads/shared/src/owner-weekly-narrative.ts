/**
 * M5.2 Phase F — owner weekly AM-style narrative.
 * Metrics-grounded only. No vibes-only copy. Metrics stay behind Details.
 * Read-only digest unless a nested recommended action Approves through apply_jobs.
 */

import type { BookedJob, CallRecord } from "./attribution";
import type { CrmLead } from "./lead-lifecycle";
import type { Platform } from "./types";

export type NarrativeEntity = {
  entityType: string;
  externalId: string;
  name: string;
  status: string;
};

export type NarrativeMetric = {
  entityExternalId: string;
  entityType: string;
  window: string;
  spendUsd: string;
  impressions: number;
  clicks: number;
  conversions: string;
};

export type WeeklyNarrativeMetrics = {
  spend7dUsd: string;
  spend30dUsd: string;
  leads7d: number;
  leads30d: number;
  campaignCount: number;
  wasteSpend7dUsd: string;
  wasteCampaigns: string[];
  winnerName: string | null;
  winnerLeads7d: number | null;
  loserName: string | null;
  callsAnswered: number | null;
  bookedJobs: number | null;
  newLeads: number | null;
  weekOf: string;
  source: "synced_metrics";
};

export type WeeklyNarrativeBrief = {
  headline: string;
  paragraphs: string[];
  wins: string[];
  risks: string[];
  next: string[];
  metrics: WeeklyNarrativeMetrics;
  grounded: true;
};

export type WeeklyNarrativeRecDraft = {
  type: "weekly_narrative";
  ruleId: string;
  title: string;
  rationale: string;
  why: string;
  risk: "low" | "medium" | "high";
  estimatedImpactUsd: string | null;
  evidence: Record<string, unknown>;
  mutations: Array<{
    action: "review" | "update_budget" | "pause";
    entity: NarrativeEntity;
    payload: Record<string, unknown>;
  }>;
};

export const WEEKLY_NARRATIVE_SHIFT_PERCENT = 10;

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return Math.max(0, value).toFixed(2);
}

function dollars(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `$${rounded.toFixed(rounded >= 100 ? 0 : 2)}`;
}

function mondayOf(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc.toISOString().slice(0, 10);
}

function metricFor(metrics: NarrativeMetric[], externalId: string, window: string): NarrativeMetric | undefined {
  return metrics.find((row) => row.entityExternalId === externalId && row.window === window);
}

export function summarizeWeeklyMetrics(input: {
  entities: NarrativeEntity[];
  metrics: NarrativeMetric[];
  now?: Date;
  calls?: CallRecord[];
  bookedJobs?: BookedJob[];
  leads?: CrmLead[];
  callTrackingVisible?: boolean;
  bookedVisible?: boolean;
  leadLifecycleVisible?: boolean;
}): WeeklyNarrativeMetrics {
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  let spend7d = 0;
  let spend30d = 0;
  let leads7d = 0;
  let leads30d = 0;
  const waste: Array<{ name: string; spend: number }> = [];
  let winner: { name: string; leads: number; spend: number; cpa: number } | null = null;
  let loser: { name: string; leads: number; spend: number; cpa: number } | null = null;

  for (const campaign of campaigns) {
    const m7 = metricFor(input.metrics, campaign.externalId, "7d");
    const m30 = metricFor(input.metrics, campaign.externalId, "30d");
    const s7 = num(m7?.spendUsd);
    const s30 = num(m30?.spendUsd);
    const l7 = num(m7?.conversions);
    const l30 = num(m30?.conversions);
    spend7d += s7;
    spend30d += s30;
    leads7d += l7;
    leads30d += l30;
    if (s7 >= 50 && l7 <= 0) waste.push({ name: campaign.name, spend: s7 });
    const cpa = l7 > 0 ? s7 / l7 : s7 > 0 ? Number.POSITIVE_INFINITY : null;
    if (cpa != null && Number.isFinite(cpa)) {
      if (!winner || cpa < winner.cpa) winner = { name: campaign.name, leads: l7, spend: s7, cpa };
      if (!loser || cpa > loser.cpa) loser = { name: campaign.name, leads: l7, spend: s7, cpa };
    } else if (s7 > 0 && l7 <= 0) {
      if (!loser || loser.cpa < Number.POSITIVE_INFINITY) {
        loser = { name: campaign.name, leads: l7, spend: s7, cpa: Number.POSITIVE_INFINITY };
      }
    }
  }
  if (winner && loser && winner.name === loser.name) loser = null;

  return {
    spend7dUsd: money(spend7d),
    spend30dUsd: money(spend30d),
    leads7d,
    leads30d,
    campaignCount: campaigns.length,
    wasteSpend7dUsd: money(waste.reduce((sum, row) => sum + row.spend, 0)),
    wasteCampaigns: waste.map((row) => row.name),
    winnerName: winner?.name ?? null,
    winnerLeads7d: winner?.leads ?? null,
    loserName: loser?.name ?? null,
    callsAnswered: input.callTrackingVisible
      ? (input.calls ?? []).filter((row) => row.answered).length
      : null,
    bookedJobs: input.bookedVisible ? (input.bookedJobs ?? []).length : null,
    newLeads: input.leadLifecycleVisible ? (input.leads ?? []).length : null,
    weekOf: mondayOf(input.now ?? new Date()),
    source: "synced_metrics",
  };
}

export function buildWeeklyNarrative(metrics: WeeklyNarrativeMetrics): WeeklyNarrativeBrief {
  const spend7 = num(metrics.spend7dUsd);
  const spend30 = num(metrics.spend30dUsd);
  const waste = num(metrics.wasteSpend7dUsd);
  const paragraphs: string[] = [];
  const wins: string[] = [];
  const risks: string[] = [];
  const next: string[] = [];

  if (metrics.campaignCount === 0 || (spend7 <= 0 && spend30 <= 0 && metrics.leads7d <= 0)) {
    const empty =
      "No synced spend or leads in the last 7 days. Connect and sync before this brief can cite numbers.";
    return {
      headline: "Weekly brief — no synced numbers yet",
      paragraphs: [empty],
      wins: [],
      risks: [empty],
      next: ["Run a check after sync so next week's brief can cite spend and leads."],
      metrics,
      grounded: true,
    };
  }

  paragraphs.push(
    `This week (from ${metrics.weekOf}) you spent ${dollars(spend7)} across ${metrics.campaignCount} campaign${metrics.campaignCount === 1 ? "" : "s"}.`,
  );
  paragraphs.push(
    metrics.leads7d > 0
      ? `Those ads brought in ${metrics.leads7d} lead${metrics.leads7d === 1 ? "" : "s"} in 7 days (${metrics.leads30d} in 30 days).`
      : `No leads in the last 7 days. 30-day spend is ${dollars(spend30)} with ${metrics.leads30d} lead${metrics.leads30d === 1 ? "" : "s"}.`,
  );

  if (metrics.callsAnswered != null) {
    paragraphs.push(
      metrics.callsAnswered > 0
        ? `${metrics.callsAnswered} answered call${metrics.callsAnswered === 1 ? "" : "s"} joined from call tracking.`
        : "Call tracking is on. No answered calls in the latest pull.",
    );
  }
  if (metrics.bookedJobs != null) {
    paragraphs.push(
      metrics.bookedJobs > 0
        ? `${metrics.bookedJobs} booked job${metrics.bookedJobs === 1 ? "" : "s"} are in the latest CRM pull.`
        : "Booked-job join is on. No booked jobs in the latest pull.",
    );
  }
  if (metrics.newLeads != null) {
    paragraphs.push(
      metrics.newLeads > 0
        ? `${metrics.newLeads} CRM lead${metrics.newLeads === 1 ? "" : "s"} are on the lead path.`
        : "Lead lifecycle is on. No CRM leads in the latest pull.",
    );
  }

  if (metrics.winnerName && metrics.winnerLeads7d != null && metrics.winnerLeads7d > 0) {
    wins.push(
      `${metrics.winnerName} brought in ${metrics.winnerLeads7d} lead${metrics.winnerLeads7d === 1 ? "" : "s"} this week.`,
    );
  }
  if (spend7 > 0 && metrics.leads7d > 0) {
    wins.push(`Spend this week produced ${metrics.leads7d} lead${metrics.leads7d === 1 ? "" : "s"} for ${dollars(spend7)}.`);
  }

  if (waste > 0 && metrics.wasteCampaigns.length > 0) {
    risks.push(
      `${metrics.wasteCampaigns.join(", ")} spent ${dollars(waste)} this week with no leads.`,
    );
    next.push(`Pause or cut ${metrics.wasteCampaigns[0]} after Approve if you want that spend to stop.`);
  }
  if (metrics.loserName && metrics.winnerName && metrics.loserName !== metrics.winnerName) {
    risks.push(`${metrics.loserName} is weaker than ${metrics.winnerName} on this week's leads.`);
    next.push(`Move 10% of budget from ${metrics.loserName} toward ${metrics.winnerName} only after Approve.`);
  }
  if (next.length === 0) {
    next.push("No live change is required this week. Approve on this card records the brief only.");
  }

  const headline =
    waste > 0
      ? `Weekly brief — ${dollars(waste)} spent with no leads`
      : metrics.leads7d > 0
        ? `Weekly brief — ${metrics.leads7d} lead${metrics.leads7d === 1 ? "" : "s"} for ${dollars(spend7)}`
        : `Weekly brief — ${dollars(spend7)} spent, no leads`;

  return {
    headline,
    paragraphs,
    wins,
    risks,
    next,
    metrics,
    grounded: true,
  };
}

export function recsFromWeeklyNarrative(input: {
  platform: Platform;
  entities: NarrativeEntity[];
  metrics: NarrativeMetric[];
  writable: boolean;
  now?: Date;
  calls?: CallRecord[];
  bookedJobs?: BookedJob[];
  leads?: CrmLead[];
  callTrackingVisible?: boolean;
  bookedVisible?: boolean;
  leadLifecycleVisible?: boolean;
}): WeeklyNarrativeRecDraft[] {
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  const summary = summarizeWeeklyMetrics(input);
  const brief = buildWeeklyNarrative(summary);
  const wasteName = summary.wasteCampaigns[0];
  const wasteEntity = wasteName ? campaigns.find((row) => row.name === wasteName) : null;
  const winner = summary.winnerName ? campaigns.find((row) => row.name === summary.winnerName) : null;
  const loser = summary.loserName ? campaigns.find((row) => row.name === summary.loserName) : null;
  const nestedPause = Boolean(input.writable && wasteEntity);
  const nestedShift = Boolean(input.writable && !nestedPause && winner && loser && winner.externalId !== loser.externalId);
  const reviewTarget = wasteEntity ?? winner ?? campaigns[0];
  const mutations: WeeklyNarrativeRecDraft["mutations"] = [];

  if (nestedPause && wasteEntity) {
    mutations.push({
      action: "pause",
      entity: wasteEntity,
      payload: {
        reason: "weekly_narrative_pause_waste",
        m52: "owner_weekly_narrative",
        nestedAction: true,
      },
    });
  } else if (nestedShift && winner && loser) {
    mutations.push(
      {
        action: "update_budget",
        entity: loser,
        payload: {
          percent: -WEEKLY_NARRATIVE_SHIFT_PERCENT,
          direction: "down",
          reason: "weekly_narrative_shift_from",
          m52: "owner_weekly_narrative",
          nestedAction: true,
        },
      },
      {
        action: "update_budget",
        entity: winner,
        payload: {
          percent: WEEKLY_NARRATIVE_SHIFT_PERCENT,
          direction: "up",
          reason: "weekly_narrative_shift_to",
          m52: "owner_weekly_narrative",
          nestedAction: true,
        },
      },
    );
  } else if (reviewTarget) {
    mutations.push({
      action: "review",
      entity: reviewTarget,
      payload: {
        action: "weekly_narrative_review_only",
        m52: "owner_weekly_narrative",
        nestedAction: false,
      },
    });
  }

  const why = brief.paragraphs[0] ?? brief.headline;
  const rationale = `${brief.headline} ${brief.paragraphs.join(" ")} ${brief.next[0] ?? ""} This is a read-only owner brief unless you Approve a recommended action inside it. Deny or Snooze writes nothing.`.slice(0, 4000);

  return [
    {
      type: "weekly_narrative",
      ruleId: "owner_weekly_narrative",
      title: brief.headline.slice(0, 200),
      why,
      rationale,
      risk: num(summary.wasteSpend7dUsd) > 0 ? "medium" : "low",
      estimatedImpactUsd: num(summary.wasteSpend7dUsd) > 0 ? summary.wasteSpend7dUsd : null,
      evidence: {
        inbox: "weekly_narrative",
        writes: false,
        grounded: true,
        source: "synced_metrics",
        weekOf: summary.weekOf,
        headline: brief.headline,
        paragraphs: brief.paragraphs,
        wins: brief.wins,
        risks: brief.risks,
        next: brief.next,
        spend7dUsd: summary.spend7dUsd,
        spend30dUsd: summary.spend30dUsd,
        leads7d: summary.leads7d,
        leads30d: summary.leads30d,
        campaignCount: summary.campaignCount,
        wasteSpend7dUsd: summary.wasteSpend7dUsd,
        wasteCampaigns: summary.wasteCampaigns,
        winnerName: summary.winnerName,
        loserName: summary.loserName,
        callsAnswered: summary.callsAnswered,
        bookedJobs: summary.bookedJobs,
        newLeads: summary.newLeads,
        nestedAction: nestedPause || nestedShift,
        hint:
          nestedPause || nestedShift
            ? "Approve may run the recommended action inside this brief. The brief itself is not a vibe."
            : "Read-only brief. Approve records it. Nothing writes live ads from the digest alone.",
      },
      mutations,
    },
  ];
}

export function isM52WeeklyNarrativeMutation(mutation: {
  action?: string;
  payload?: Record<string, unknown>;
}): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "owner_weekly_narrative") return true;
  const reason = payload.reason;
  return typeof reason === "string" && reason.startsWith("weekly_narrative_");
}

export function isWeeklyNarrativeNestedAction(mutation: { payload?: Record<string, unknown> }): boolean {
  return mutation.payload?.nestedAction === true && isM52WeeklyNarrativeMutation(mutation);
}

export function publicWeeklyNarrativeView(brief: WeeklyNarrativeBrief): {
  headline: string;
  paragraphs: string[];
  wins: string[];
  risks: string[];
  next: string[];
  metrics: WeeklyNarrativeMetrics;
  grounded: true;
  writes: false;
} {
  return {
    headline: brief.headline,
    paragraphs: brief.paragraphs,
    wins: brief.wins,
    risks: brief.risks,
    next: brief.next,
    metrics: brief.metrics,
    grounded: true,
    writes: false,
  };
}
