/**
 * Isolation notes encoded as constants so importers cannot "forget" the week-one rules.
 *
 * - OS Neon uses an isolated schema. Do not merge OS tables into Brain public/pgvector.
 * - OS auth is separate from Brain APP_PASSWORD week one.
 * - No duplicate Neon / Railway / Inngest apps for OS.
 * - No Tavily requirement for OS.
 * - M3 (shared Neon smoke) is held until that smoke exists.
 */

export const ISOLATION = {
  osNeon: "isolated-schema",
  brainNeon: "public+pgvector",
  osAuth: "separate-from-brain-app-password",
  brainAuth: "APP_PASSWORD",
  sharedInngestApp: "shopify-brain",
  tavilyRequiredForOs: false,
  m3SharedNeonSmoke: "held",
} as const;
