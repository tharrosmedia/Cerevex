/**
 * M5.2 Phase F — seasonality + offer calendar.
 * Planning only. Calendar→campaign coupling is recommend or Approve→apply.
 * Default HVAC windows so QA works without an operator save.
 * Live mutations stay update_budget / pause after Approve when the flag is on.
 */

import type { Platform } from "./types";

export const SEASONALITY_LOOKAHEAD_DAYS = 14;
export const SEASONALITY_RAMP_PERCENT = 10;
export const SEASONALITY_SHIFT_PERCENT = 10;

export const OFFER_INTENTS = ["ramp", "pause", "shift", "hold"] as const;
export type OfferIntent = (typeof OFFER_INTENTS)[number];

export const OFFER_KINDS = ["seasonal", "offer"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export type OfferWindow = {
  id: string;
  name: string;
  kind: OfferKind;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  intent: OfferIntent;
  campaignHint?: string | null;
  offerCopy?: string | null;
};

export type SeasonalityCalendar = {
  windows: OfferWindow[];
  updatedAt: string | null;
  source: "default" | "workspace";
};

export type SeasonalityEntity = {
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId?: string | null;
};

export type SeasonalityMetric = {
  entityExternalId: string;
  entityType: string;
  window: string;
  spendUsd: string;
  impressions: number;
  clicks: number;
  conversions: string;
};

export type SeasonalityRecDraft = {
  type: "seasonality";
  ruleId: string;
  title: string;
  rationale: string;
  why: string;
  risk: "low" | "medium" | "high";
  estimatedImpactUsd: string | null;
  evidence: Record<string, unknown>;
  mutations: Array<{
    action: "review" | "update_budget" | "pause";
    entity: SeasonalityEntity;
    payload: Record<string, unknown>;
  }>;
};

export const DEFAULT_HVAC_WINDOWS: OfferWindow[] = [
  {
    id: "hvac-winter-heat",
    name: "Winter heat",
    kind: "seasonal",
    startMonth: 12,
    startDay: 1,
    endMonth: 2,
    endDay: 28,
    intent: "ramp",
    campaignHint: "furnace",
    offerCopy: "Same-week furnace check before the next cold snap.",
  },
  {
    id: "hvac-spring-tuneup",
    name: "Spring tune-up",
    kind: "seasonal",
    startMonth: 3,
    startDay: 1,
    endMonth: 5,
    endDay: 31,
    intent: "ramp",
    campaignHint: "tune",
    offerCopy: "Ductless tune-up from $89.",
  },
  {
    id: "hvac-summer-cool",
    name: "Summer cooling",
    kind: "seasonal",
    startMonth: 6,
    startDay: 1,
    endMonth: 8,
    endDay: 31,
    intent: "ramp",
    campaignHint: "ductless",
    offerCopy: "Same-week ductless install. Book a home visit.",
  },
  {
    id: "hvac-fall-shift",
    name: "Fall shift to heat",
    kind: "seasonal",
    startMonth: 9,
    startDay: 1,
    endMonth: 11,
    endDay: 15,
    intent: "shift",
    campaignHint: "furnace",
    offerCopy: "Move money toward heat before the first freeze.",
  },
  {
    id: "hvac-late-nov-hold",
    name: "Late-November hold",
    kind: "offer",
    startMonth: 11,
    startDay: 16,
    endMonth: 11,
    endDay: 30,
    intent: "hold",
    campaignHint: null,
    offerCopy: "Hold new spend-up until the holiday week is over.",
  },
];

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function clampDay(month: number, day: number): number {
  if (month === 2) return Math.min(Math.max(day, 1), 29);
  if ([4, 6, 9, 11].includes(month)) return Math.min(Math.max(day, 1), 30);
  return Math.min(Math.max(day, 1), 31);
}

function isOfferIntent(value: unknown): value is OfferIntent {
  return typeof value === "string" && (OFFER_INTENTS as readonly string[]).includes(value);
}

function isOfferKind(value: unknown): value is OfferKind {
  return typeof value === "string" && (OFFER_KINDS as readonly string[]).includes(value);
}

export function parseOfferWindow(raw: unknown): OfferWindow | null {
  const row = asRecord(raw);
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const startMonth = Number(row.startMonth);
  const startDay = Number(row.startDay);
  const endMonth = Number(row.endMonth);
  const endDay = Number(row.endDay);
  if (!id || !name) return null;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return null;
  if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) return null;
  if (!Number.isInteger(startDay) || startDay < 1) return null;
  if (!Number.isInteger(endDay) || endDay < 1) return null;
  if (!isOfferIntent(row.intent) || !isOfferKind(row.kind)) return null;
  return {
    id: id.slice(0, 80),
    name: name.slice(0, 80),
    kind: row.kind,
    startMonth,
    startDay: clampDay(startMonth, startDay),
    endMonth,
    endDay: clampDay(endMonth, endDay),
    intent: row.intent,
    campaignHint: typeof row.campaignHint === "string" && row.campaignHint.trim() ? row.campaignHint.trim().slice(0, 80) : null,
    offerCopy: typeof row.offerCopy === "string" && row.offerCopy.trim() ? row.offerCopy.trim().slice(0, 200) : null,
  };
}

export function seasonalityFromSettings(settingsJson: unknown): SeasonalityCalendar {
  const root = asRecord(settingsJson);
  const planning = asRecord(root.planning);
  return parseSeasonalityCalendar(planning.seasonality);
}

export function parseSeasonalityCalendar(raw: unknown): SeasonalityCalendar {
  const row = asRecord(raw);
  const list = Array.isArray(row.windows) ? row.windows : [];
  const windows = list.map(parseOfferWindow).filter((item): item is OfferWindow => Boolean(item));
  if (windows.length === 0) {
    return {
      windows: DEFAULT_HVAC_WINDOWS.map((item) => ({ ...item })),
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
      source: "default",
    };
  }
  return {
    windows,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    source: "workspace",
  };
}

export function defaultSeasonalityCalendar(): SeasonalityCalendar {
  return {
    windows: DEFAULT_HVAC_WINDOWS.map((item) => ({ ...item })),
    updatedAt: null,
    source: "default",
  };
}

function ordinal(month: number, day: number): number {
  return month * 31 + day;
}

function dateOrdinal(date: Date): number {
  return ordinal(date.getUTCMonth() + 1, date.getUTCDate());
}

export function windowContains(window: OfferWindow, date: Date): boolean {
  const cur = dateOrdinal(date);
  const start = ordinal(window.startMonth, window.startDay);
  const end = ordinal(window.endMonth, window.endDay);
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end;
}

/** Days until the next start, wrapping the year. 0 if already inside. */
export function daysUntilWindow(window: OfferWindow, date: Date): number {
  if (windowContains(window, date)) return 0;
  for (let offset = 1; offset <= 366; offset += 1) {
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
    if (windowContains(window, next)) return offset;
  }
  return 366;
}

export function windowLabel(window: OfferWindow): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const start = `${months[window.startMonth - 1] ?? "?"} ${window.startDay}`;
  const end = `${months[window.endMonth - 1] ?? "?"} ${window.endDay}`;
  return `${start}–${end}`;
}

export function classifyWindows(windows: OfferWindow[], now: Date = new Date()): {
  active: OfferWindow[];
  upcoming: OfferWindow[];
} {
  const active: OfferWindow[] = [];
  const upcoming: OfferWindow[] = [];
  for (const window of windows) {
    if (windowContains(window, now)) {
      active.push(window);
      continue;
    }
    if (daysUntilWindow(window, now) <= SEASONALITY_LOOKAHEAD_DAYS) upcoming.push(window);
  }
  return { active, upcoming };
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return Math.max(0, value).toFixed(2);
}

function matchCampaign(campaigns: SeasonalityEntity[], hint: string | null | undefined): SeasonalityEntity | null {
  if (!hint) return campaigns[0] ?? null;
  const needle = hint.toLowerCase();
  return (
    campaigns.find((row) => row.name.toLowerCase().includes(needle)) ??
    campaigns[0] ??
    null
  );
}

function otherCampaign(campaigns: SeasonalityEntity[], keep: SeasonalityEntity | null): SeasonalityEntity | null {
  if (!keep) return campaigns[1] ?? campaigns[0] ?? null;
  return campaigns.find((row) => row.externalId !== keep.externalId) ?? null;
}

function spendFor(metrics: SeasonalityMetric[], externalId: string, window: string): number {
  const row = metrics.find((item) => item.entityExternalId === externalId && item.window === window);
  return num(row?.spendUsd);
}

export function intentWhy(window: OfferWindow, phase: "active" | "upcoming"): string {
  const when = phase === "active" ? `now (${windowLabel(window)})` : `in the next ${SEASONALITY_LOOKAHEAD_DAYS} days (${windowLabel(window)})`;
  if (window.intent === "ramp") {
    return `${window.name} is ${when}. Raise spend on the matching campaign only after Approve.`;
  }
  if (window.intent === "pause") {
    return `${window.name} is ${when}. Pause the matching campaign only after Approve.`;
  }
  if (window.intent === "shift") {
    return `${window.name} is ${when}. Move money toward the seasonal campaign only after Approve.`;
  }
  return `${window.name} is ${when}. Hold new spend-up. This card does not raise budgets.`;
}

export function recsFromSeasonality(input: {
  platform: Platform;
  entities: SeasonalityEntity[];
  metrics: SeasonalityMetric[];
  calendar: SeasonalityCalendar;
  writable: boolean;
  now?: Date;
}): SeasonalityRecDraft[] {
  const now = input.now ?? new Date();
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  const { active, upcoming } = classifyWindows(input.calendar.windows, now);
  const focus = active[0] ?? upcoming[0];
  if (!focus) return [];
  const phase: "active" | "upcoming" = active[0] ? "active" : "upcoming";
  const target = matchCampaign(campaigns, focus.campaignHint);
  const counterpart = otherCampaign(campaigns, target);
  const why = intentWhy(focus, phase);
  const writable = input.writable && phase === "active" && focus.intent !== "hold";
  const spend30 = target ? spendFor(input.metrics, target.externalId, "30d") : 0;
  const mutations: SeasonalityRecDraft["mutations"] = [];

  if (target && writable && focus.intent === "ramp") {
    mutations.push({
      action: "update_budget",
      entity: target,
      payload: {
        percent: SEASONALITY_RAMP_PERCENT,
        direction: "up",
        reason: "seasonality_ramp",
        m52: "seasonality_calendar",
        windowId: focus.id,
      },
    });
  } else if (target && writable && focus.intent === "pause") {
    mutations.push({
      action: "pause",
      entity: target,
      payload: {
        reason: "seasonality_pause",
        m52: "seasonality_calendar",
        windowId: focus.id,
      },
    });
  } else if (target && counterpart && writable && focus.intent === "shift") {
    mutations.push(
      {
        action: "update_budget",
        entity: counterpart,
        payload: {
          percent: -SEASONALITY_SHIFT_PERCENT,
          direction: "down",
          reason: "seasonality_shift_from",
          m52: "seasonality_calendar",
          windowId: focus.id,
        },
      },
      {
        action: "update_budget",
        entity: target,
        payload: {
          percent: SEASONALITY_SHIFT_PERCENT,
          direction: "up",
          reason: "seasonality_shift_to",
          m52: "seasonality_calendar",
          windowId: focus.id,
        },
      },
    );
  } else if (target) {
    mutations.push({
      action: "review",
      entity: target,
      payload: {
        action: "seasonality_review_only",
        m52: "seasonality_calendar",
        windowId: focus.id,
        intent: focus.intent,
        writable: input.writable,
      },
    });
  }

  const title =
    focus.intent === "shift"
      ? `Move money for ${focus.name}`
      : focus.intent === "pause"
        ? `Pause for ${focus.name}`
        : focus.intent === "hold"
          ? `Hold spend-up for ${focus.name}`
          : `Ramp for ${focus.name}`;

  return [
    {
      type: "seasonality",
      ruleId: phase === "active" ? "seasonality_active" : "seasonality_upcoming",
      title,
      why,
      rationale: `${why}${focus.offerCopy ? ` Offer: ${focus.offerCopy}` : ""} Approve records this. Deny or Snooze writes nothing. Cerevex will not change live ads unless seasonality is on and you Approve.`,
      risk: focus.intent === "pause" ? "medium" : "low",
      estimatedImpactUsd: spend30 > 0 ? money(spend30 * 0.1) : null,
      evidence: {
        inbox: "seasonality",
        writes: false,
        windowId: focus.id,
        windowName: focus.name,
        windowKind: focus.kind,
        windowWhen: windowLabel(focus),
        intent: focus.intent,
        phase,
        campaignHint: focus.campaignHint,
        campaignName: target?.name ?? null,
        offerCopy: focus.offerCopy,
        calendarSource: input.calendar.source,
        hint:
          writable
            ? "Approve may change the matching campaign budget or pause it."
            : phase === "upcoming"
              ? "Upcoming window — planning only until the dates start."
              : "Recommend only — Approve will not change live ads until the flag is on.",
      },
      mutations,
    },
  ];
}

export function isM52SeasonalityMutation(mutation: {
  action?: string;
  payload?: Record<string, unknown>;
}): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "seasonality_calendar") return true;
  const reason = payload.reason;
  return typeof reason === "string" && reason.startsWith("seasonality_");
}

export function publicSeasonalityView(calendar: SeasonalityCalendar, now: Date = new Date()): {
  windows: Array<OfferWindow & { active: boolean; upcoming: boolean; when: string }>;
  active: OfferWindow[];
  upcoming: OfferWindow[];
  source: SeasonalityCalendar["source"];
  updatedAt: string | null;
  writes: false;
} {
  const { active, upcoming } = classifyWindows(calendar.windows, now);
  const activeIds = new Set(active.map((row) => row.id));
  const upcomingIds = new Set(upcoming.map((row) => row.id));
  return {
    windows: calendar.windows.map((row) => ({
      ...row,
      active: activeIds.has(row.id),
      upcoming: upcomingIds.has(row.id),
      when: windowLabel(row),
    })),
    active,
    upcoming,
    source: calendar.source,
    updatedAt: calendar.updatedAt,
    writes: false,
  };
}
