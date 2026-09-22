/**
 * Isolation notes encoded as constants so importers cannot "forget" the week-one rules.
 *
 * - OS Neon uses an isolated schema. Do not merge OS tables into Brain public/pgvector.
 * - OS auth is separate from Brain APP_PASSWORD week one.
 * - No duplicate Neon / Railway / Inngest orgs for OS. Distinct Inngest app ids
 *   (Brain `shopify-brain`, OS `tharros-os`) share Cloud keys so OS sync cannot clobber seo.
 * - No Tavily requirement for OS.
 * - M3 (shared Neon smoke) is held until that smoke exists.
 */

export const ISOLATION = {
  osNeon: "isolated-schema",
  brainNeon: "public+pgvector",
  osAuth: "separate-from-brain-app-password",
  brainAuth: "APP_PASSWORD",
  brainInngestApp: "shopify-brain",
  osInngestApp: "tharros-os",
  shareInngestCloudKeys: true,
  tavilyRequiredForOs: false,
  m3SharedNeonSmoke: "held",
} as const;
