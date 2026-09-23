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
export { evaluateApplyGate, applyBlockMessage, APPLY_BLOCK_REASONS } from "./apply-gate";
export {
  findingDraftSchema,
  recommendationDraftSchema,
  proposedMutationSchema,
  applyMutationSchema,
  parseFindingDraft,
  parseRecommendationDraft,
  parseApplyMutations,
} from "./audit-schemas";
