/**
 * Cerevex capability flag registry (modularity retrofit).
 *
 * Per-workspace product capabilities beyond Modules & Nav IA.
 * Optional env global kill can hide a capability without redeploy.
 *
 * States:
 * - on — available
 * - hidden — unfinished / off; UI hides, writes refuse safely
 * - recommend_only — visible as a recommendation, no writes
 *
 * Env kills (any one is enough):
 * - CAPABILITY_KILL=apply,connect.meta
 * - CAPABILITY_KILL_APPLY=1  (dots → underscores, uppercased)
 * - FEATURE_BID_MUTATIONS=0 / FEATURE_BUDGET_MUTATIONS=0 (legacy → apply.bid / apply.budget)
 * - PLATFORM_SYNC_LIVE=0 (legacy → sync.live)
 */

export const CAPABILITY_STATES = ["on", "hidden", "recommend_only"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const CAPABILITY_IDS = [
  "cockpit",
  "apply",
  "connect.meta",
  "connect.google",
  "audits",
  "apply.bid",
  "apply.budget",
  "apply.create_entity",
  "sync.live",
  "shell.legacy_ads_web",
  "m51.budget_shift",
  "m51.grok_creatives",
  "m51.lp_congruence",
  "m51.ga4_connect",
  "m51.brainstorm",
  "m52.callrail_connect",
  "m52.bundled_call_tracking",
  "m52.crm_join",
  "m52.lead_lifecycle",
  "m52.booked_job_signal",
  "m52.clarity_connect",
  "m52.lp_intelligence",
  "m52.creative_fatigue",
  "m52.search_negatives",
  "m52.geo_discipline",
  "m52.brand_guardrails",
  "m52.seasonality_calendar",
  "m52.owner_weekly_narrative",
  "site.wordpress.connect",
  "site.wordpress.sync",
  "site.wordpress.apply",
  "seo.gsc.recommendations",
  "seo.gsc.apply",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityFlags = Record<CapabilityId, CapabilityState>;
export type CapabilityOverrides = Partial<Record<CapabilityId, CapabilityState>>;

export type CapabilityCatalogEntry = {
  id: CapabilityId;
  label: string;
  help: string;
  defaultState: CapabilityState;
  unfinished: boolean;
  group: "product" | "apply" | "shell" | "m51" | "m52" | "site" | "seo";
};

export const CAPABILITY_CATALOG: Record<CapabilityId, CapabilityCatalogEntry> = {
  cockpit: {
    id: "cockpit",
    label: "Ads cockpit",
    help: "In-shell Ads home, suggestions, and read path.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  apply: {
    id: "apply",
    label: "Apply",
    help: "Approve queues async platform writes. Kill switch and freeze still apply.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "connect.meta": {
    id: "connect.meta",
    label: "Connect Meta",
    help: "Start Meta OAuth or mock connect for this workspace.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "connect.google": {
    id: "connect.google",
    label: "Connect Google",
    help: "Start Google Ads OAuth or mock connect for this workspace.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  audits: {
    id: "audits",
    label: "Audits",
    help: "Run ads checks. Existing findings stay readable when this is off.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "apply.bid": {
    id: "apply.bid",
    label: "Bid mutations",
    help: "Allow update_bid under Approve. Legacy env: FEATURE_BID_MUTATIONS.",
    defaultState: "on",
    unfinished: false,
    group: "apply",
  },
  "apply.budget": {
    id: "apply.budget",
    label: "Budget mutations",
    help: "Allow update_budget under Approve. Legacy env: FEATURE_BUDGET_MUTATIONS.",
    defaultState: "on",
    unfinished: false,
    group: "apply",
  },
  "apply.create_entity": {
    id: "apply.create_entity",
    label: "Create-entity apply",
    help: "Allow create_ad / add_keyword under Approve (Grok Promote path). Default hidden. Soft-launch stays off until Adam enables it.",
    defaultState: "hidden",
    unfinished: false,
    group: "apply",
  },
  "sync.live": {
    id: "sync.live",
    label: "Live platform sync",
    help: "Allow Meta/Google live pull and apply when app keys are set. Off degrades to mock. Legacy env: PLATFORM_SYNC_LIVE=0.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "shell.legacy_ads_web": {
    id: "shell.legacy_ads_web",
    label: "Legacy ads-web chrome",
    help: "Leftover apps/ads/web cockpit. Default hidden — operator path is in-shell /ads.",
    defaultState: "hidden",
    unfinished: true,
    group: "shell",
  },
  "m51.budget_shift": {
    id: "m51.budget_shift",
    label: "Budget shift",
    help: "Recommend moving spend toward the winning platform or campaign. Approve applies budget mutations only when this is on. recommend_only shows the suggestion and writes nothing. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m51",
  },
  "m51.grok_creatives": {
    id: "m51.grok_creatives",
    label: "Grok creatives",
    help: "See creatives, adapt with Grok, then Promote → Approve to create an ad. Generate never writes live. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m51",
  },
  "m51.lp_congruence": {
    id: "m51.lp_congruence",
    label: "Landing-page match",
    help: "Compare the ad promise to the landing page. Recommend-only — Site apply is not in this slice. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m51",
  },
  "m51.ga4_connect": {
    id: "m51.ga4_connect",
    label: "Funnel (GA4 + pixel)",
    help: "Connect GA4 and/or the Cerevex first-party pixel so funnel data can strengthen recommendations. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m51",
  },
  "m51.brainstorm": {
    id: "m51.brainstorm",
    label: "Brainstorm",
    help: "Leads / brainstorm surface for Grok alternatives. Nav and /ads/leads need this visible. modules.leads is IA only. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m51",
  },
  "m52.callrail_connect": {
    id: "m52.callrail_connect",
    label: "CallRail connect (M5.2)",
    help: "Connect Got Ductless CallRail (API key or mock) and join calls to campaigns. Default hidden. No unsupervised writes.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.bundled_call_tracking": {
    id: "m52.bundled_call_tracking",
    label: "Bundled call tracking (M5.2)",
    help: "Paid Cerevex add-on for shops without CallRail. Twilio-class lean (~$20–80/mo). Mock for QA. Default hidden. Does not buy numbers or change routing.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.crm_join": {
    id: "m52.crm_join",
    label: "CRM booked-job join (M5.2)",
    help: "Connect Housecall Pro (mock or live) and pull leads plus booked-job status. Soft-join to calls. No unsupervised CRM writes — Approve gates any write.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.lead_lifecycle": {
    id: "m52.lead_lifecycle",
    label: "Lead lifecycle (M5.2)",
    help: "Show lead → contacted → booked cards in Cerevex. Recommend-only CRM mutations. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.booked_job_signal": {
    id: "m52.booked_job_signal",
    label: "Booked-job ads signal (M5.2)",
    help: "Use booked jobs as an ads optimization signal in the rec inbox. Approve may shift budget only when this is on. recommend_only shows the suggestion and writes nothing. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.clarity_connect": {
    id: "m52.clarity_connect",
    label: "Clarity connect (M5.2)",
    help: "Connect Microsoft Clarity for aggregated heatmap and session signals. Mock for QA. No in-house session recorder. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.lp_intelligence": {
    id: "m52.lp_intelligence",
    label: "LP intelligence (M5.2)",
    help: "Hero / structure / copy / wizard recs from Clarity session signals, with a plain-language why. Site apply later until a Site connector can mutate. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.creative_fatigue": {
    id: "m52.creative_fatigue",
    label: "Creative fatigue (M5.2)",
    help: "Recommend a refresh when an ad looks tired, with a plain-language why and a cadence. Recommend-only mutations. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.search_negatives": {
    id: "m52.search_negatives",
    label: "Search-term hygiene (M5.2)",
    help: "Recommend Google negatives for wasteful search terms. Approve applies negatives only when this is on. recommend_only shows the suggestion and writes nothing. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.geo_discipline": {
    id: "m52.geo_discipline",
    label: "Geo / service-area (M5.2)",
    help: "Recommend tightening targeting to the shop's service area. Approve may record a geo tighten only when this is on. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.brand_guardrails": {
    id: "m52.brand_guardrails",
    label: "Claim & brand guardrails (M5.2)",
    help: "Block or warn on risky claims and brand language. Never silently allow unsupervised spend past a guardrail. Pause writes only when this is on. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.seasonality_calendar": {
    id: "m52.seasonality_calendar",
    label: "Seasonality + offer calendar (M5.2)",
    help: "Plan seasonal offers and see calendar-driven recs. Live campaign changes stay Approve-gated. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "m52.owner_weekly_narrative": {
    id: "m52.owner_weekly_narrative",
    label: "Owner weekly narrative (M5.2)",
    help: "In-app weekly AM-style brief grounded in synced spend, leads, and waste. Read-only unless you Approve a recommended action. Default hidden.",
    defaultState: "hidden",
    unfinished: false,
    group: "m52",
  },
  "site.wordpress.connect": {
    id: "site.wordpress.connect",
    label: "WordPress connect",
    help: "Connect a WordPress site with the Cerevex plugin. Default hidden until the pilot is enabled. Off never 500s SEO or ads.",
    defaultState: "hidden",
    unfinished: false,
    group: "site",
  },
  "site.wordpress.sync": {
    id: "site.wordpress.sync",
    label: "WordPress sync",
    help: "Sync posts and pages into Brain for this store. Default hidden. Off hides Sync and refuses the job without taking down SEO.",
    defaultState: "hidden",
    unfinished: false,
    group: "site",
  },
  "site.wordpress.apply": {
    id: "site.wordpress.apply",
    label: "WordPress apply",
    help: "Approve-gated title/body/meta writes through the plugin. Default hidden. recommend_only shows the draft and writes nothing.",
    defaultState: "hidden",
    unfinished: false,
    group: "site",
  },
  "seo.gsc.recommendations": {
    id: "seo.gsc.recommendations",
    label: "Search recommendations",
    help: "Turn synced Search Console data into conversion-biased recommendations. Default hidden. Off hides the cards and skips generation; Connect and Sync still work.",
    defaultState: "hidden",
    unfinished: false,
    group: "seo",
  },
  "seo.gsc.apply": {
    id: "seo.gsc.apply",
    label: "Search recommendation apply",
    help: "Approve-gated Shopify (or WordPress) writes from Search recommendations. Default hidden. recommend_only keeps drafts and writes nothing.",
    defaultState: "hidden",
    unfinished: false,
    group: "seo",
  },
};

export const CAPABILITY_CATALOG_LIST: CapabilityCatalogEntry[] = CAPABILITY_IDS.map(
  (id) => CAPABILITY_CATALOG[id],
);

/** Operator Settings: hide dark M5.1 placeholders until unfinished is cleared. */
export function isCapabilityInOperatorSettings(entry: CapabilityCatalogEntry): boolean {
  return !(entry.group === "m51" && entry.unfinished);
}

export const OPERATOR_CAPABILITY_CATALOG_LIST: CapabilityCatalogEntry[] =
  CAPABILITY_CATALOG_LIST.filter(isCapabilityInOperatorSettings);

/**
 * Unfinished m51.* cannot be turned on from Settings or PATCH.
 * hidden / recommend_only stay allowed so Cos can stage visibility without going live.
 */
export function capabilityOnBlockedReason(
  id: CapabilityId,
  state: CapabilityState,
): string | null {
  if (state !== "on") return null;
  const entry = CAPABILITY_CATALOG[id];
  if (!entry || entry.group !== "m51" || !entry.unfinished) return null;
  return `${entry.label} is not live yet. It cannot be turned on until that work ships.`;
}

export function blockedUnfinishedCapabilityOns(overrides: CapabilityOverrides): CapabilityId[] {
  const blocked: CapabilityId[] = [];
  for (const id of CAPABILITY_IDS) {
    const state = overrides[id];
    if (state && capabilityOnBlockedReason(id, state)) blocked.push(id);
  }
  return blocked;
}

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && (CAPABILITY_IDS as readonly string[]).includes(value);
}

export function isCapabilityState(value: unknown): value is CapabilityState {
  return typeof value === "string" && (CAPABILITY_STATES as readonly string[]).includes(value);
}

export function defaultCapabilityFlags(): CapabilityFlags {
  const flags = {} as CapabilityFlags;
  for (const id of CAPABILITY_IDS) {
    flags[id] = CAPABILITY_CATALOG[id].defaultState;
  }
  return flags;
}

export function capabilityEnvKillKey(id: CapabilityId): string {
  return `CAPABILITY_KILL_${id.replace(/\./g, "_").toUpperCase()}`;
}

function envTruthy(raw: string | undefined): boolean {
  if (raw == null || raw === "") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function envExplicitOff(raw: string | undefined): boolean {
  if (raw == null || raw === "") return false;
  const value = raw.trim().toLowerCase();
  return value === "0" || value === "false" || value === "off";
}

export type ProcessEnvMap = Record<string, string | undefined>;

/** Browser-safe. Reads process.env when present — no node:fs, no @types/node. */
export function readProcessEnv(): ProcessEnvMap {
  const runtime = globalThis as { process?: { env?: ProcessEnvMap } };
  return runtime.process?.env ?? {};
}

export function envCapabilityKills(env: ProcessEnvMap = readProcessEnv()): CapabilityId[] {
  const kills = new Set<CapabilityId>();
  const list = env.CAPABILITY_KILL ?? "";
  for (const part of list.split(",")) {
    const id = part.trim();
    if (isCapabilityId(id)) kills.add(id);
  }
  for (const id of CAPABILITY_IDS) {
    if (envTruthy(env[capabilityEnvKillKey(id)])) kills.add(id);
  }
  if (envExplicitOff(env.FEATURE_BID_MUTATIONS)) kills.add("apply.bid");
  if (envExplicitOff(env.FEATURE_BUDGET_MUTATIONS)) kills.add("apply.budget");
  if (envExplicitOff(env.PLATFORM_SYNC_LIVE)) kills.add("sync.live");
  return [...kills];
}

export function parseCapabilityOverrides(raw: unknown): CapabilityOverrides {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const next: CapabilityOverrides = {};
  for (const id of CAPABILITY_IDS) {
    if (isCapabilityState(input[id])) next[id] = input[id];
  }
  return next;
}

export function mergeCapabilityFlags(
  overrides: CapabilityOverrides | null | undefined,
  fallback: CapabilityFlags = defaultCapabilityFlags(),
): CapabilityFlags {
  const next = { ...fallback };
  if (!overrides) return next;
  for (const id of CAPABILITY_IDS) {
    const value = overrides[id];
    if (isCapabilityState(value)) next[id] = value;
  }
  return next;
}

export function applyEnvKills(
  flags: CapabilityFlags,
  env: ProcessEnvMap = readProcessEnv(),
): CapabilityFlags {
  const next = { ...flags };
  for (const id of envCapabilityKills(env)) {
    next[id] = "hidden";
  }
  return next;
}

/**
 * Resolve stored settings_json.capabilities + catalog defaults + env kills.
 * Never throws. Missing / garbage JSON → defaults.
 */
export function resolveWorkspaceCapabilities(
  settingsJson: unknown,
  env: ProcessEnvMap = readProcessEnv(),
): CapabilityFlags {
  const obj = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
    ? (settingsJson as Record<string, unknown>)
    : {};
  const stored = parseCapabilityOverrides(obj.capabilities ?? obj);
  return applyEnvKills(mergeCapabilityFlags(stored), env);
}

export function settingsJsonWithCapabilityOverrides(
  existing: Record<string, unknown>,
  overrides: CapabilityOverrides,
): Record<string, unknown> {
  const current = parseCapabilityOverrides(existing.capabilities);
  return {
    ...existing,
    capabilities: { ...current, ...parseCapabilityOverrides(overrides) },
  };
}

export function isCapabilityOn(id: CapabilityId, flags: CapabilityFlags): boolean {
  return flags[id] === "on";
}

export function isCapabilityVisible(id: CapabilityId, flags: CapabilityFlags): boolean {
  return flags[id] === "on" || flags[id] === "recommend_only";
}

/** Call attribution recs from CallRail Connect or Bundled — either flag is enough. */
export function isCallAttributionVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.callrail_connect", flags) || isCapabilityVisible("m52.bundled_call_tracking", flags);
}

export function isLpIntelligenceVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.lp_intelligence", flags);
}

export function isLpIntelligenceWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.lp_intelligence", flags);
}

export function isCreativeFatigueVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.creative_fatigue", flags);
}

export function isSearchNegativesVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.search_negatives", flags);
}

export function isSearchNegativesWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.search_negatives", flags);
}

export function isGeoDisciplineVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.geo_discipline", flags);
}

export function isGeoDisciplineWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.geo_discipline", flags);
}

export function isBrandGuardrailsVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.brand_guardrails", flags);
}

export function isBrandGuardrailsWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.brand_guardrails", flags);
}

/** Creative-fatigue recs are recommend-only. Writes stay blocked unless the flag is on (safety). */
export function creativeFatigueWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "creative_fatigue") return null;
  if (isCapabilityOn("m52.creative_fatigue", flags)) return null;
  return flags["m52.creative_fatigue"] === "recommend_only"
    ? "capability_m52_creative_fatigue_recommend_only"
    : "capability_m52_creative_fatigue";
}

/** Search-term negatives may write only when m52.search_negatives is on. */
export function searchNegativesWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "search_negatives") return null;
  if (isSearchNegativesWritable(flags)) return null;
  return flags["m52.search_negatives"] === "recommend_only"
    ? "capability_m52_search_negatives_recommend_only"
    : "capability_m52_search_negatives";
}

/** Geo / service-area writes only when m52.geo_discipline is on. */
export function geoDisciplineWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "geo_discipline") return null;
  if (isGeoDisciplineWritable(flags)) return null;
  return flags["m52.geo_discipline"] === "recommend_only"
    ? "capability_m52_geo_discipline_recommend_only"
    : "capability_m52_geo_discipline";
}

/** Brand/claim pause writes only when m52.brand_guardrails is on. */
export function brandGuardrailsWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "brand_guardrails") return null;
  if (isBrandGuardrailsWritable(flags)) return null;
  return flags["m52.brand_guardrails"] === "recommend_only"
    ? "capability_m52_brand_guardrails_recommend_only"
    : "capability_m52_brand_guardrails";
}

export function isSeasonalityCalendarVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.seasonality_calendar", flags);
}

export function isSeasonalityCalendarWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.seasonality_calendar", flags);
}

export function isOwnerWeeklyNarrativeVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.owner_weekly_narrative", flags);
}

export function isOwnerWeeklyNarrativeWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.owner_weekly_narrative", flags);
}

/** Calendar→campaign writes only when m52.seasonality_calendar is on. */
export function seasonalityWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "seasonality") return null;
  if (isSeasonalityCalendarWritable(flags)) return null;
  return flags["m52.seasonality_calendar"] === "recommend_only"
    ? "capability_m52_seasonality_calendar_recommend_only"
    : "capability_m52_seasonality_calendar";
}

/** Weekly narrative nested actions write only when m52.owner_weekly_narrative is on. */
export function ownerWeeklyNarrativeWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "weekly_narrative") return null;
  if (isOwnerWeeklyNarrativeWritable(flags)) return null;
  return flags["m52.owner_weekly_narrative"] === "recommend_only"
    ? "capability_m52_owner_weekly_narrative_recommend_only"
    : "capability_m52_owner_weekly_narrative";
}

export function isLeadLifecycleVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.lead_lifecycle", flags);
}

export function isBookedJobSignalVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("m52.booked_job_signal", flags);
}

export function isBookedJobSignalWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m52.booked_job_signal", flags);
}

/** Booked-job optimize recs may write ads only when m52.booked_job_signal is on. */
export function bookedJobSignalWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "booked_job") return null;
  if (isBookedJobSignalWritable(flags)) return null;
  return flags["m52.booked_job_signal"] === "recommend_only"
    ? "capability_m52_booked_job_signal_recommend_only"
    : "capability_m52_booked_job_signal";
}

export function isCapabilityWritable(id: CapabilityId, flags: CapabilityFlags): boolean {
  return flags[id] === "on";
}

/** Leftover ads-web chrome is break-glass only. Default hidden. */
export function isLegacyAdsWebAllowed(flags: CapabilityFlags): boolean {
  return isCapabilityWritable("shell.legacy_ads_web", flags);
}

/** Live Meta/Google pull + apply. Env PLATFORM_SYNC_LIVE=0 is a global kill. */
export function isPlatformSyncLiveOn(flags: CapabilityFlags): boolean {
  return isCapabilityOn("sync.live", flags);
}

/** Deploy-time companion for leftover chrome links. Not a second product flag. */
export function isLegacyAdsChromeEnvEnabled(env: ProcessEnvMap = readProcessEnv()): boolean {
  return env.NEXT_PUBLIC_ADS_LEGACY_CHROME === "1";
}

/**
 * Console may emit NEXT_PUBLIC_ADS_ORIGIN only when leftover chrome is on
 * AND the deploy-time env companion is set. G2 still hard-blocks /app/*.
 */
export function legacyAdsChromeLinksAllowed(
  flags: CapabilityFlags,
  env: ProcessEnvMap = readProcessEnv(),
): boolean {
  return isLegacyAdsWebAllowed(flags) && isLegacyAdsChromeEnvEnabled(env);
}

/** Approve may queue writes only when apply is on (not hidden / recommend_only). */
export function isApplyEnabled(flags: CapabilityFlags): boolean {
  return isCapabilityWritable("apply", flags);
}

export function canApproveWithApply(operatorCanApprove: boolean, flags: CapabilityFlags): boolean {
  return Boolean(operatorCanApprove) && isApplyEnabled(flags);
}

/** Budget-shift recs may write only when m51.budget_shift is on (not hidden / recommend_only). */
export function isBudgetShiftWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("m51.budget_shift", flags);
}

export function budgetShiftWriteBlockedReason(
  flags: CapabilityFlags,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "budget_shift") return null;
  if (isBudgetShiftWritable(flags)) return null;
  return flags["m51.budget_shift"] === "recommend_only"
    ? "capability_m51_budget_shift_recommend_only"
    : "capability_m51_budget_shift";
}

export type LegacyAdsWebGate = "loading" | "unauthenticated" | "allow" | "block";

/**
 * Hard-gate leftover /app/* chrome. Fail closed once a session exists.
 * Sign-in stays available so an operator can authenticate, then get redirected.
 */
export function legacyAdsWebGate(input: {
  loading: boolean;
  authenticated: boolean;
  capabilities: CapabilityFlags;
}): LegacyAdsWebGate {
  if (input.loading) return "loading";
  if (!input.authenticated) return "unauthenticated";
  return isLegacyAdsWebAllowed(input.capabilities) ? "allow" : "block";
}

export function capabilityBlockMessage(id: CapabilityId, state: CapabilityState | undefined): string {
  const label = CAPABILITY_CATALOG[id]?.label ?? id;
  if (state === "recommend_only") {
    return `${label} is recommend-only for this workspace. Nothing was written.`;
  }
  return `${label} is off for this workspace.`;
}

export function filterItemsByCapabilities<T extends { capability?: CapabilityId }>(
  items: T[],
  flags: CapabilityFlags,
): T[] {
  return items.filter((item) => item.capability == null || isCapabilityVisible(item.capability, flags));
}

export function isWordpressConnectVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("site.wordpress.connect", flags);
}

export function isWordpressConnectWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("site.wordpress.connect", flags);
}

export function isWordpressSyncVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("site.wordpress.sync", flags);
}

export function isWordpressSyncWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("site.wordpress.sync", flags);
}

export function isWordpressApplyVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("site.wordpress.apply", flags);
}

export function isWordpressApplyWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("site.wordpress.apply", flags);
}

export function wordpressConnectBlockedReason(flags: CapabilityFlags): string | null {
  if (isWordpressConnectWritable(flags)) return null;
  return flags["site.wordpress.connect"] === "recommend_only"
    ? "capability_site_wordpress_connect_recommend_only"
    : "capability_site_wordpress_connect";
}

export function wordpressSyncBlockedReason(flags: CapabilityFlags): string | null {
  if (isWordpressSyncWritable(flags)) return null;
  return flags["site.wordpress.sync"] === "recommend_only"
    ? "capability_site_wordpress_sync_recommend_only"
    : "capability_site_wordpress_sync";
}

export function wordpressApplyBlockedReason(flags: CapabilityFlags): string | null {
  if (isWordpressApplyWritable(flags)) return null;
  return flags["site.wordpress.apply"] === "recommend_only"
    ? "capability_site_wordpress_apply_recommend_only"
    : "capability_site_wordpress_apply";
}

export function isGscRecommendationsVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("seo.gsc.recommendations", flags);
}

export function isGscRecommendationsOn(flags: CapabilityFlags): boolean {
  return isCapabilityOn("seo.gsc.recommendations", flags);
}

export function isGscApplyVisible(flags: CapabilityFlags): boolean {
  return isCapabilityVisible("seo.gsc.apply", flags);
}

export function isGscApplyWritable(flags: CapabilityFlags): boolean {
  return isCapabilityOn("seo.gsc.apply", flags);
}

export function gscRecommendationsBlockedReason(flags: CapabilityFlags): string | null {
  if (isGscRecommendationsOn(flags) || flags["seo.gsc.recommendations"] === "recommend_only") return null;
  return "capability_seo_gsc_recommendations";
}

export function gscApplyBlockedReason(flags: CapabilityFlags): string | null {
  if (isGscApplyWritable(flags)) return null;
  return flags["seo.gsc.apply"] === "recommend_only"
    ? "capability_seo_gsc_apply_recommend_only"
    : "capability_seo_gsc_apply";
}
