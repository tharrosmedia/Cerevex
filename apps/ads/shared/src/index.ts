export * from "./types";
export * from "./modules";
export * from "./roles";
export * from "./mutations";
export * from "./approve";
export * from "./capabilities";
export * from "./mutation-families";
export {
  ADS_NAV_CATALOG,
  ADS_NAV_HREFS_IN_SHELL,
  ADS_NAV_HREFS_LEGACY_WEB,
  LEADS_CAPABILITY_ID,
  LEADS_NOT_LIVE_COPY,
  isLeadsProductUnfinished,
  isLeadsSurfaceVisible,
  resolveAdsNav,
} from "@cerevex/contracts";
export type { AdsNavItemId, AdsNavShell, ResolvedAdsNavItem } from "@cerevex/contracts";
export {
  IN_MARKET_CAPABILITY_ID,
  IN_MARKET_LOOKBACK_DAYS,
  IN_MARKET_DEFAULT_WINDOW,
  IN_MARKET_HELPER,
  IN_MARKET_LOAD_ERROR,
  IN_MARKET_EMPTY_META,
  IN_MARKET_EMPTY_GOOGLE,
  IN_MARKET_CONNECT_META,
  IN_MARKET_CONNECT_GOOGLE,
  buildInMarketView,
  parseInMarketWindow,
  inMarketChip,
  inMarketDeepLink,
  cockpitCostPerResultUsd,
  cockpitClickRate,
} from "@cerevex/contracts";
export type { InMarketView, InMarketPlatform, InMarketWindowId } from "@cerevex/contracts";
export type {
  AdPlatformConnector,
  AnalyticsConnector,
  CallTrackingConnector,
  Connector,
  ConnectorConnectInput,
  ConnectorConnectResult,
  CrmConnector,
  SiteConnector,
} from "./connectors/types";
// Node-only helpers stay on subpaths (`./env`, `./crypto`, `./oauth`, `./connectors`).
// Re-exporting them here pulls `node:fs` into Next client chunks (Turbopack
// `/app/page` build failure).
export { mockPull } from "./platforms";
export { evaluateAccount, AUDIT_THRESHOLDS } from "./audit-engine";
export {
  HYGIENE_THRESHOLDS,
  evaluateOperatorHygiene,
  recsFromCreativeFatigue,
  recsFromSearchNegatives,
  recsFromGeoDiscipline,
  recsFromBrandGuardrails,
  scanClaimHits,
  claimHitsForEntity,
  brandGuardrailSpendBlockedReason,
  isSpendIncreasingMutation,
  isM52SearchNegativeMutation,
  isM52GeoDisciplineMutation,
  isM52BrandGuardrailMutation,
  isM52CreativeFatigueMutation,
  mockWasteSearchTerms,
  searchTermsFromRaw,
  geoFromRaw,
  isBroadGeo,
} from "./operator-hygiene";
export type { HygieneRecDraft, HygieneEntity, HygieneMetric, SearchTermRow, ClaimHit } from "./operator-hygiene";
export {
  DEFAULT_HVAC_WINDOWS,
  SEASONALITY_LOOKAHEAD_DAYS,
  classifyWindows,
  defaultSeasonalityCalendar,
  daysUntilWindow,
  intentWhy,
  isM52SeasonalityMutation,
  parseOfferWindow,
  parseSeasonalityCalendar,
  publicSeasonalityView,
  recsFromSeasonality,
  seasonalityFromSettings,
  windowContains,
  windowLabel,
} from "./seasonality-calendar";
export type { OfferIntent, OfferKind, OfferWindow, SeasonalityCalendar, SeasonalityRecDraft } from "./seasonality-calendar";
export {
  WEEKLY_NARRATIVE_SHIFT_PERCENT,
  buildWeeklyNarrative,
  isM52WeeklyNarrativeMutation,
  isWeeklyNarrativeNestedAction,
  publicWeeklyNarrativeView,
  recsFromWeeklyNarrative,
  summarizeWeeklyMetrics,
} from "./owner-weekly-narrative";
export type {
  WeeklyNarrativeBrief,
  WeeklyNarrativeMetrics,
  WeeklyNarrativeRecDraft,
} from "./owner-weekly-narrative";
export { evaluateClientM51, M51_THRESHOLDS } from "./m51-engine";
export {
  analyzeCopySentiment,
  compareAdsInGroup,
  creativeFromRaw,
  otherPlatform,
  platformLabel as creativePlatformLabel,
} from "./creative-analysis";
export { compareAdToLanding, landingFromCreative } from "./lp-congruence";
export {
  mockClaritySignals,
  mockClaritySnapshot,
  recsFromSessionSignals,
  siteApplyBlockedReason,
  siteApplyMode,
  siteLandingPageApplySupported,
  publicClarityView,
  LP_INTELLIGENCE_KINDS,
} from "./lp-intelligence";
export type {
  AggregatedSessionSignal,
  LpIntelligenceKind,
  LpIntelligenceRecDraft,
  SessionSignalsSnapshot,
} from "./lp-intelligence";
export { summarizeFunnel, funnelStrengthFor, inferPlatformFromClick, FUNNEL_EVENT_NAMES } from "./funnel";
export {
  summarizeAttribution,
  joinCallToCampaigns,
  joinBookedJob,
  mockCallRailCalls,
  mockBundledCalls,
  mockHcpBookedJobs,
} from "./attribution";
export type { CallRecord, BookedJob, CallJoin, AttributionSummary, AttributionCampaign } from "./attribution";
export {
  mockHcpLeads,
  summarizeLeadLifecycle,
  recsFromLeadLifecycle,
  recsFromBookedJobSignal,
  crmWriteBlockedReason,
  publicLeadView,
  LEAD_STAGES,
} from "./lead-lifecycle";
export type {
  CrmLead,
  LeadStage,
  LeadLifecycleCard,
  LeadLifecycleSummary,
  LeadLifecycleRecDraft,
  BookedJobSignalRecDraft,
} from "./lead-lifecycle";
export {
  evaluateApplyGate,
  applyBlockMessage,
  adsPlatformMutationRefusal,
  APPLY_BLOCK_REASONS,
  NOT_AD_ACCOUNT_SCOPED,
} from "./apply-gate";
// Skill-config import and the database guard use pg-connection-string (Node `fs`).
// They live on `@tharros/ads-shared/server`, not this client-reachable barrel.
export { SKILL_CLIENT_ALIASES } from "./skill-client-aliases";
export {
  findingDraftSchema,
  recommendationDraftSchema,
  proposedMutationSchema,
  applyMutationSchema,
  parseFindingDraft,
  parseRecommendationDraft,
  parseApplyMutations,
} from "./audit-schemas";
