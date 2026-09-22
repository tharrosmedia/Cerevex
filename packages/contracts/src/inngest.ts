/**
 * Inngest event prefixes (Plan 1.5).
 *
 * KEEP `seo/*` and `seo-*`. Do not mass-rename to `brain/*`.
 * Paid jobs: meta/ads/*, google/ads/*. Shared OS orchestration: os/*.
 * No unsupervised ad writes / no Meta-Google mutate.
 */

export const INNGEST_PREFIXES = {
  seo: "seo/",
  os: "os/",
  metaAds: "meta/ads/",
  metaOrganic: "meta/organic/",
  googleAds: "google/ads/",
} as const;

export type InngestPrefix = (typeof INNGEST_PREFIXES)[keyof typeof INNGEST_PREFIXES];

export const INNGEST_EVENT_PREFIX = INNGEST_PREFIXES;

export const INNGEST_FUNCTION_ID_PREFIX = {
  os: "os-",
  seo: "seo-",
  metaAds: "meta-ads-",
  googleAds: "google-ads-",
} as const;

export type InngestProduct = keyof typeof INNGEST_PREFIXES;

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

export const OS_EVENTS = {
  stubPing: "os/stub.ping",
  stubSync: "os/stub.sync",
  applyRequested: "os/apply.requested",
  auditRequested: "os/audit.requested",
} as const;

export const PAID_EVENTS = {
  metaAdsAccountSync: "meta/ads/account.sync",
  googleAdsAccountSync: "google/ads/account.sync",
} as const;

export function inngestEventName(product: "os" | "seo", name: string): string {
  const trimmed = name.replace(/^(os|seo|tharros|brain|meta\/ads|google\/ads)\//, "");
  return `${INNGEST_PREFIXES[product]}${trimmed}`;
}

export function inngestFunctionId(product: "os" | "seo", id: string): string {
  const trimmed = id.replace(/^(os|seo|tharros|brain)-/, "");
  return `${INNGEST_FUNCTION_ID_PREFIX[product]}${trimmed}`;
}

export type InngestEnvelope<TName extends string, TData extends Record<string, unknown>> = {
  id?: string;
  name: TName;
  data: TData & {
    workspaceId?: string;
    clientId?: string | null;
    storeId?: string;
  };
};
