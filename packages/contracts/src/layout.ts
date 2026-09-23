/**
 * Canonical tree — Accelerated Merge Plan 1.5.
 */

export const PLAN_15_DOC = "docs/accelerated-merge-plan-1.5.md" as const;

export const CANONICAL_TREE = [
  "apps/brain",
  "apps/ads",
  "jobs/meta/ads",
  "jobs/meta/organic",
  "jobs/google/ads",
  "jobs/seo",
  "packages/contracts",
  "packages/db",
  "packages/shared",
] as const;

export type CanonicalPath = (typeof CANONICAL_TREE)[number];

export const DAY1_MOVE = {
  nextRootToAppsBrain: "Next root → apps/brain",
  seoInngestToJobsSeo: "seo Inngest → jobs/seo (KEEP seo/* event names and seo-* function IDs)",
  osToAppsOs: "Origin tharros-os (now Cerevex ads module) M1/M2 → apps/ads",
  metaAds: "jobs/meta/ads (legacy folder; emits/listens ads/account.sync, platform=meta)",
  googleAds: "jobs/google/ads (legacy folder; emits/listens ads/account.sync, platform=google)",
} as const;
