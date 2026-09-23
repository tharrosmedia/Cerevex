/**
 * Landing-page congruence: compare the ad promise to the page headline/body/offer.
 * Recommend-only. No Site / WordPress write path exists in this slice.
 */

import { copyBlob, type CreativeFields } from "./creative-analysis";

export type LpSnapshotView = {
  url: string;
  title?: string | null;
  headline?: string | null;
  bodyText?: string | null;
  offerText?: string | null;
};

export type LpMismatch = {
  matched: boolean;
  score: number;
  why: string;
  recommendedFixes: string[];
  siteApply: "later";
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "from",
  "this",
  "that",
  "are",
  "our",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "or",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

export function landingFromCreative(fields: CreativeFields, raw: unknown): LpSnapshotView | null {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const landing =
    obj.landingPage && typeof obj.landingPage === "object" && !Array.isArray(obj.landingPage)
      ? (obj.landingPage as Record<string, unknown>)
      : {};
  const url =
    (typeof fields.landingPageUrl === "string" && fields.landingPageUrl) ||
    (typeof landing.url === "string" ? landing.url : null);
  if (!url) return null;
  return {
    url,
    title: typeof landing.title === "string" ? landing.title : null,
    headline: typeof landing.headline === "string" ? landing.headline : null,
    bodyText: typeof landing.body === "string" ? landing.body : typeof landing.bodyText === "string" ? landing.bodyText : null,
    offerText: typeof landing.offer === "string" ? landing.offer : fields.offer ?? null,
  };
}

export function compareAdToLanding(ad: CreativeFields, page: LpSnapshotView): LpMismatch {
  const adText = copyBlob(ad);
  const pageText = [page.title, page.headline, page.bodyText, page.offerText].filter(Boolean).join(" ");
  const adTokens = tokens(adText);
  const pageTokens = tokens(pageText);
  if (adTokens.size === 0 || pageTokens.size === 0) {
    return {
      matched: true,
      score: 1,
      why: "Not enough ad or page copy to compare. Nothing was invented.",
      recommendedFixes: [],
      siteApply: "later",
    };
  }
  let overlap = 0;
  for (const word of adTokens) {
    if (pageTokens.has(word)) overlap += 1;
  }
  const score = overlap / adTokens.size;
  const adOffer = (ad.offer ?? ad.headline ?? "").trim();
  const pageOffer = (page.offerText ?? page.headline ?? "").trim();
  const offerMismatch =
    adOffer.length > 0 &&
    pageOffer.length > 0 &&
    !pageOffer.toLowerCase().includes(adOffer.toLowerCase().slice(0, 18)) &&
    !adOffer.toLowerCase().includes(pageOffer.toLowerCase().slice(0, 18));

  if (score >= 0.35 && !offerMismatch) {
    return {
      matched: true,
      score: Number(score.toFixed(2)),
      why: "The landing page repeats the same service idea as the ad.",
      recommendedFixes: [],
      siteApply: "later",
    };
  }

  const fixes: string[] = [];
  if (ad.headline) {
    fixes.push(`Put the ad line “${ad.headline}” in the page headline so the visitor sees the same promise.`);
  }
  if (offerMismatch) {
    fixes.push(`Match the offer. The ad says “${adOffer}” but the page says “${pageOffer}”.`);
  }
  if (ad.body) {
    fixes.push("Repeat the service, area, and next step from the ad in the first screen of the page.");
  }
  if (fixes.length === 0) {
    fixes.push("Repeat the ad’s service and offer in the page headline and first paragraph.");
  }

  return {
    matched: false,
    score: Number(score.toFixed(2)),
    why: offerMismatch
      ? `The ad promise does not match the page. The ad talks about “${adOffer}” and the page talks about “${pageOffer}”.`
      : "The landing page does not repeat the words or offer from the ad.",
    recommendedFixes: fixes,
    siteApply: "later",
  };
}
