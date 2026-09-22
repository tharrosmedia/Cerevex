/**
 * Inngest event prefixes (Plan 1.5).
 *
 * KEEP `seo/*` day one. Do not mass-rename to `brain/*`.
 * Future paid/organic jobs use the prefixes below. No functions ship for those prefixes yet.
 *
 * Hard constraint: no unsupervised ad writes / no Meta-Google mutate in this reshape.
 */

export const INNGEST_PREFIXES = {
  /** Existing Brain SEO path — keep as-is. */
  seo: "seo/",
  /** Reserved. Placeholder only: jobs/meta/ads */
  metaAds: "meta/ads/",
  /** Reserved. Placeholder only: jobs/meta/organic */
  metaOrganic: "meta/organic/",
  /** Reserved. Placeholder only: jobs/google/ads */
  googleAds: "google/ads/",
} as const;

export type InngestPrefix = (typeof INNGEST_PREFIXES)[keyof typeof INNGEST_PREFIXES];

/** Existing SEO events that must keep these names. */
export const SEO_EVENTS = {
  jobRequested: "seo/job.requested",
  ensureJob: "seo/ensure-job",
  research: "seo/research",
  createBrief: "seo/create-brief",
  writeDraft: "seo/write-draft",
  editDraft: "seo/edit-draft",
  optimizeDraft: "seo/optimize-draft",
  evaluate: "seo/evaluate",
  saveDraft: "seo/save-draft",
  saveApproval: "seo/save-approval",
  publish: "seo/publish",
  catalogSyncRequested: "seo/catalog.sync.requested",
  gscSyncRequested: "seo/gsc.sync.requested",
  auditRequested: "seo/audit.requested",
} as const;

/** Existing SEO function IDs that must keep these names. */
export const SEO_FUNCTION_IDS = {
  job: "seo-job",
  ensureJob: "seo-ensure-job",
  research: "seo-research",
  createBrief: "seo-create-brief",
  writeDraft: "seo-write-draft",
  editDraft: "seo-edit-draft",
  optimizeDraft: "seo-optimize-draft",
  evaluate: "seo-evaluate",
  gradeDraft: "seo-grade-draft",
  reviseDraft: "seo-revise-draft",
  saveDraft: "seo-save-draft",
  saveApproval: "seo-save-approval",
  publish: "seo-publish",
  catalogSync: "seo-catalog-sync",
  gscSync: "seo-gsc-sync",
  audit: "seo-audit",
} as const;
