/**
 * Inngest event prefixes (R5 / G7).
 *
 * KEEP `seo/*` and `seo-*`. Do not mass-rename to `brain/*`.
 * Paid ads + ads orchestration use generic `ads/*` names. Platform is event
 * data (`meta` | `google`), not the event namespace.
 *
 * Legacy `os/*`, `meta/ads/*`, and `google/ads/*` stay registered as one-release
 * aliases so in-flight Cerevex ads jobs are not stranded. Remove LEGACY_* after
 * that release. Live Inngest app ids stay `shopify-brain` (SEO) and `cerevex-ads`.
 */

export const INNGEST_PREFIXES = {
  seo: "seo/",
  ads: "ads/",
  metaOrganic: "meta/organic/",
} as const;

export type InngestPrefix = (typeof INNGEST_PREFIXES)[keyof typeof INNGEST_PREFIXES];

export const INNGEST_EVENT_PREFIX = INNGEST_PREFIXES;

/** @deprecated R5 — old product prefixes. Listeners only; do not emit. */
export const LEGACY_INNGEST_PREFIXES = {
  os: "os/",
  metaAds: "meta/ads/",
  googleAds: "google/ads/",
} as const;

export const INNGEST_FUNCTION_ID_PREFIX = {
  ads: "ads-",
  seo: "seo-",
} as const;

/** @deprecated R5 — old function-id prefixes. Registered as aliases for one release. */
export const LEGACY_INNGEST_FUNCTION_ID_PREFIX = {
  os: "os-",
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

/** Canonical Cerevex ads events. Platform is payload data, not the name. */
export const ADS_EVENTS = {
  stubPing: "ads/stub.ping",
  stubSync: "ads/stub.sync",
  applyRequested: "ads/apply.requested",
  auditRequested: "ads/audit.requested",
  accountSync: "ads/account.sync",
} as const;

/**
 * @deprecated R5 — same values as ADS_EVENTS (minus accountSync). Prefer ADS_EVENTS.
 * Kept so existing `OS_EVENTS.applyRequested` imports keep compiling.
 */
export const OS_EVENTS = {
  stubPing: ADS_EVENTS.stubPing,
  stubSync: ADS_EVENTS.stubSync,
  applyRequested: ADS_EVENTS.applyRequested,
  auditRequested: ADS_EVENTS.auditRequested,
} as const;

export const PAID_EVENTS = {
  accountSync: ADS_EVENTS.accountSync,
  /** @deprecated platform is data — same event as accountSync */
  metaAdsAccountSync: ADS_EVENTS.accountSync,
  /** @deprecated platform is data — same event as accountSync */
  googleAdsAccountSync: ADS_EVENTS.accountSync,
} as const;

export const ADS_FUNCTION_IDS = {
  stubPing: "ads-stub-ping",
  stubSync: "ads-stub-sync",
  applyRequested: "ads-apply-requested",
  auditRequested: "ads-audit-requested",
  accountSync: "ads-account-sync",
} as const;

/** Old event names still accepted by dual listeners. Do not emit after this release. */
export const LEGACY_ADS_EVENTS = {
  stubPing: "os/stub.ping",
  stubSync: "os/stub.sync",
  applyRequested: "os/apply.requested",
  auditRequested: "os/audit.requested",
  metaAdsAccountSync: "meta/ads/account.sync",
  googleAdsAccountSync: "google/ads/account.sync",
} as const;

/** Old function ids still registered so mid-step runs can finish. */
export const LEGACY_ADS_FUNCTION_IDS = {
  stubPing: "os-stub-ping",
  stubSync: "os-stub-sync",
  applyRequested: "os-apply-requested",
  auditRequested: "os-audit-requested",
  metaAdsAccountSync: "meta-ads-account-sync",
  googleAdsAccountSync: "google-ads-account-sync",
} as const;

export function inngestEventName(product: "ads" | "os" | "seo", name: string): string {
  const trimmed = name.replace(/^(os|seo|tharros|brain|ads|meta\/ads|google\/ads)\//, "");
  const prefix = product === "seo" ? INNGEST_PREFIXES.seo : INNGEST_PREFIXES.ads;
  return `${prefix}${trimmed}`;
}

export function inngestFunctionId(product: "ads" | "os" | "seo", id: string): string {
  const trimmed = id.replace(/^(os|seo|tharros|brain|ads|meta-ads|google-ads)-/, "");
  const prefix = product === "seo" ? INNGEST_FUNCTION_ID_PREFIX.seo : INNGEST_FUNCTION_ID_PREFIX.ads;
  return `${prefix}${trimmed}`;
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
