/**
 * Creative visualization helpers. Sentiment and lift use only the copy and
 * metrics already on the entity — never invent platform numbers.
 */

export type CreativeFields = {
  headline?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  landingPageUrl?: string | null;
  offer?: string | null;
};

export type SentimentLabel = "warm" | "mixed" | "cautious";

export type CopySentiment = {
  label: SentimentLabel;
  why: string;
  hits: string[];
};

export type AdCompareRow = {
  externalId: string;
  name: string;
  platform: "meta" | "google";
  impressions: number;
  clicks: number;
  conversions: number;
  spendUsd: number;
};

export type QuantifiedLift = {
  winnerId: string;
  loserId: string;
  metric: "ctr" | "cpa";
  winnerValue: number;
  loserValue: number;
  liftPercent: number | null;
  why: string;
};

const WARM = [
  "free",
  "trusted",
  "factory",
  "trained",
  "same-week",
  "same week",
  "local",
  "home visit",
  "repair",
  "install",
  "tune-up",
  "tune up",
];
const CAUTIOUS = ["cheap", "limited time", "act now", "guaranteed", "lowest", "urgent"];

export function creativeFromRaw(raw: unknown): CreativeFields {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const landing =
    obj.landingPage && typeof obj.landingPage === "object" && !Array.isArray(obj.landingPage)
      ? (obj.landingPage as Record<string, unknown>)
      : {};
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    headline: text(obj.headline) ?? text(obj.title),
    body: text(obj.body) ?? text(obj.primaryText) ?? text(obj.description),
    imageUrl: text(obj.imageUrl) ?? text(obj.thumbnailUrl),
    landingPageUrl: text(obj.landingPageUrl) ?? text(landing.url),
    offer: text(obj.offer) ?? text(landing.offer),
  };
}

export function copyBlob(fields: CreativeFields): string {
  return [fields.headline, fields.body, fields.offer].filter(Boolean).join(" ").toLowerCase();
}

export function analyzeCopySentiment(fields: CreativeFields): CopySentiment {
  const text = copyBlob(fields);
  if (!text) {
    return { label: "mixed", why: "No ad copy was synced, so there is nothing to score.", hits: [] };
  }
  const warmHits = WARM.filter((word) => text.includes(word));
  const cautiousHits = CAUTIOUS.filter((word) => text.includes(word));
  if (warmHits.length > 0 && cautiousHits.length === 0) {
    return {
      label: "warm",
      why: `The copy talks like a local home-service shop (${warmHits.slice(0, 3).join(", ")}).`,
      hits: warmHits,
    };
  }
  if (cautiousHits.length > 0 && warmHits.length === 0) {
    return {
      label: "cautious",
      why: `The copy leans on pressure language (${cautiousHits.slice(0, 3).join(", ")}).`,
      hits: cautiousHits,
    };
  }
  if (warmHits.length > 0 && cautiousHits.length > 0) {
    return {
      label: "mixed",
      why: "The copy mixes a local service promise with pressure language.",
      hits: [...warmHits, ...cautiousHits],
    };
  }
  return { label: "mixed", why: "The copy is plain. No strong service or pressure cues.", hits: [] };
}

export function ctrOf(row: AdCompareRow): number {
  if (row.impressions <= 0) return 0;
  return row.clicks / row.impressions;
}

export function cpaOf(row: AdCompareRow): number | null {
  if (row.conversions <= 0) return row.spendUsd > 0 ? null : null;
  return row.spendUsd / row.conversions;
}

export function compareAdsInGroup(rows: AdCompareRow[]): QuantifiedLift | null {
  const usable = rows.filter((row) => row.impressions >= 100);
  if (usable.length < 2) return null;
  const byCtr = [...usable].sort((a, b) => ctrOf(b) - ctrOf(a));
  const winner = byCtr[0]!;
  const loser = byCtr[byCtr.length - 1]!;
  const winCtr = ctrOf(winner);
  const loseCtr = ctrOf(loser);
  if (winCtr <= 0 || loseCtr <= 0 || winner.externalId === loser.externalId) return null;
  const liftPercent = ((winCtr - loseCtr) / loseCtr) * 100;
  return {
    winnerId: winner.externalId,
    loserId: loser.externalId,
    metric: "ctr",
    winnerValue: winCtr,
    loserValue: loseCtr,
    liftPercent: Number(liftPercent.toFixed(1)),
    why: `${winner.name} gets clicks at ${(winCtr * 100).toFixed(2)}% vs ${(loseCtr * 100).toFixed(2)}% on ${loser.name}. That is from synced impressions and clicks only.`,
  };
}

export function otherPlatform(platform: "meta" | "google"): "meta" | "google" {
  return platform === "meta" ? "google" : "meta";
}

export function platformLabel(platform: string | null | undefined): string {
  if (platform === "google") return "Google";
  if (platform === "meta") return "Meta";
  return platform ?? "ads";
}
