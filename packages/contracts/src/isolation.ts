/**
 * Isolation notes encoded as constants so importers cannot "forget" the week-one rules.
 *
 * - Ads Neon uses an isolated schema. Do not merge ads tables into Brain public/pgvector.
 * - Ads auth is separate from Brain APP_PASSWORD week one.
 * - No duplicate Neon / Railway / Inngest orgs for the ads module. Distinct Inngest app ids
 *   (Brain `shopify-brain`, ads `cerevex-ads`) share Cloud keys so ads sync cannot clobber seo.
 *   Env key remains OS_INNGEST_APP_ID. Neon schema remains `os` (ADS_DB_SCHEMA quarantine).
 * - No Tavily requirement for the ads module.
 * - Shared Neon smoke (deploy) is still not done from ads agents.
 * - Product M3 (audits → findings → recommendations) uses schema `os` only.
 */

export const ISOLATION = {
  osNeon: "isolated-schema",
  brainNeon: "public+pgvector",
  osAuth: "separate-from-brain-app-password",
  brainAuth: "APP_PASSWORD",
  brainInngestApp: "shopify-brain",
  osInngestApp: "cerevex-ads",
  shareInngestCloudKeys: true,
  tavilyRequiredForOs: false,
  m3SharedNeonSmoke: "held",
} as const;
