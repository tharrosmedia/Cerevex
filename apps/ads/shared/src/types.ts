import type { CapabilityFlags } from "@cerevex/contracts";
import { ADS_EVENTS, LEGACY_ADS_EVENTS } from "@cerevex/contracts";
import type { BusinessType, ModuleFlags } from "./modules";

export const ROLES = ["owner", "operator", "client_readonly"] as const;
export type Role = (typeof ROLES)[number];

export const PLATFORMS = ["meta", "google"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DECISION_ACTIONS = ["authorize", "deny", "snooze"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type Membership = {
  workspaceId: string;
  role: Role;
};

export type ClientMembership = {
  clientId: string;
  role: Role;
};

export type AuthContext = {
  user: SessionUser;
  memberships: Membership[];
  clientMemberships: ClientMembership[];
};

export type ClientSummary = {
  id: string;
  workspaceId: string;
  name: string;
  pilotFlag: boolean;
  status: string;
  createdAt: string;
  connectedPlatforms?: Platform[];
  lastSyncAt?: string | null;
};

export type AdAccountPublic = {
  id: string;
  workspaceId: string;
  clientId: string;
  platform: Platform;
  externalId: string;
  connectionStatus: string;
  lastSyncAt: string | null;
  lastError: string | null;
  frozen: boolean;
  hasCredentials: boolean;
  mock: boolean;
  scopes: string[];
};

export type AdCreativePublic = {
  headline: string | null;
  body: string | null;
  imageUrl: string | null;
  landingPageUrl: string | null;
  offer: string | null;
};

export type AdEntityPublic = {
  id: string;
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId: string | null;
  platform?: Platform;
  adAccountId?: string;
  creative?: AdCreativePublic | null;
  metrics: { window: string; spendUsd: string; impressions: number; clicks: number; conversions: string }[];
};

export type OAuthPlatformConfig = {
  configured: boolean;
  redirectUri: string;
};

export type StoredOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scopes?: string[];
  mock?: boolean;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  applyKillSwitch: boolean;
  businessType: BusinessType | null;
  modules: ModuleFlags;
  onboardingComplete: boolean;
  onboardingCompletedAt: string | null;
  capabilities: CapabilityFlags;
};

export type ApplyJobPublic = {
  id: string;
  workspaceId: string;
  clientId: string;
  authorizationId: string;
  status: string;
  attempts: number;
  error: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
};

export type HealthStatus = {
  ok: boolean;
  service: string;
  version: string;
  time: string;
  checks: Record<string, "ok" | "degraded" | "down">;
};

/**
 * R5 / G7 canonical ads event names. Platform is payload data, not the namespace.
 * Brain seo/* is untouched. LEGACY_EVENTS stay for one-release dual listeners.
 */
export const EVENTS = {
  stubPing: ADS_EVENTS.stubPing,
  stubSync: ADS_EVENTS.stubSync,
  accountSync: ADS_EVENTS.accountSync,
  metaAdsAccountSync: ADS_EVENTS.accountSync,
  googleAdsAccountSync: ADS_EVENTS.accountSync,
  applyRequested: ADS_EVENTS.applyRequested,
  auditRequested: ADS_EVENTS.auditRequested,
} as const;

export const LEGACY_EVENTS = LEGACY_ADS_EVENTS;

export const AUDIT_RUN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type AuditRunStatus = (typeof AUDIT_RUN_STATUSES)[number];

export const FINDING_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const RECOMMENDATION_TYPES = [
  "review_cpa",
  "improve_ctr",
  "add_creative",
  "expand_keywords",
  "spend_concentration",
  "pause_waste",
  "budget_shift",
  "creative_test",
  "lp_congruence",
  "create_alternative",
  "call_attribution",
  "crm_booked_job",
  "lead_lifecycle",
  "booked_job",
  "lp_intelligence",
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_RISKS = ["low", "medium", "high"] as const;
export type RecommendationRisk = (typeof RECOMMENDATION_RISKS)[number];

export const RECOMMENDATION_STATUSES = ["proposed", "authorized", "denied", "snoozed"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const APPLY_JOB_STATUSES = ["queued", "applying", "succeeded", "failed", "blocked"] as const;
export type ApplyJobStatus = (typeof APPLY_JOB_STATUSES)[number];

export const MUTATION_ACTIONS = [
  "pause",
  "update_budget",
  "update_bid",
  "add_negative",
  "exclude_placement",
  "create_ad",
  "add_keyword",
  "review",
] as const;
export type MutationAction = (typeof MUTATION_ACTIONS)[number];

/** Mutate-existing classes executed under Approve. create_ad / add_keyword need apply.create_entity. */
export const EXECUTABLE_MUTATION_ACTIONS = [
  "pause",
  "add_negative",
  "exclude_placement",
  "update_bid",
  "update_budget",
] as const;
export type ExecutableMutationAction = (typeof EXECUTABLE_MUTATION_ACTIONS)[number];

export const CREATE_NEW_MUTATION_ACTIONS = ["create_ad", "add_keyword"] as const;

export const RECOMMENDATION_SCHEMA_VERSION = "1" as const;

export const OFFLINE_RECOMMENDATION_TYPES = ["call_attribution", "crm_booked_job"] as const;
export type OfflineRecommendationType = (typeof OFFLINE_RECOMMENDATION_TYPES)[number];

export function isOfflineRecommendationType(value: string): value is OfflineRecommendationType {
  return (OFFLINE_RECOMMENDATION_TYPES as readonly string[]).includes(value);
}

export const LP_INTELLIGENCE_RECOMMENDATION_TYPES = ["lp_intelligence"] as const;
export type LpIntelligenceRecommendationType = (typeof LP_INTELLIGENCE_RECOMMENDATION_TYPES)[number];

export function isLpIntelligenceRecommendationType(value: string): value is LpIntelligenceRecommendationType {
  return (LP_INTELLIGENCE_RECOMMENDATION_TYPES as readonly string[]).includes(value);
}

export const LEAD_LIFECYCLE_RECOMMENDATION_TYPES = ["lead_lifecycle"] as const;
export type LeadLifecycleRecommendationType = (typeof LEAD_LIFECYCLE_RECOMMENDATION_TYPES)[number];

export function isLeadLifecycleRecommendationType(value: string): value is LeadLifecycleRecommendationType {
  return (LEAD_LIFECYCLE_RECOMMENDATION_TYPES as readonly string[]).includes(value);
}

export const BOOKED_JOB_SIGNAL_RECOMMENDATION_TYPES = ["booked_job"] as const;
export type BookedJobSignalRecommendationType = (typeof BOOKED_JOB_SIGNAL_RECOMMENDATION_TYPES)[number];

export function isBookedJobSignalRecommendationType(value: string): value is BookedJobSignalRecommendationType {
  return (BOOKED_JOB_SIGNAL_RECOMMENDATION_TYPES as readonly string[]).includes(value);
}

export type StubPingPayload = {
  requestedBy: string;
  workspaceId: string;
  clientId?: string;
  note?: string;
  requestId?: string;
};

export type StubSyncPayload = {
  requestedBy: string;
  workspaceId: string;
  clientId: string;
  adAccountId?: string;
};

export type AdAccountSyncPayload = {
  requestedBy: string;
  workspaceId: string;
  clientId: string;
  adAccountId: string;
  platform: Platform;
};

export type ApplyRequestedPayload = {
  requestedBy: string;
  workspaceId: string;
  clientId: string;
  authorizationId: string;
  applyJobId?: string;
};

export type AuditRequestedPayload = {
  requestedBy: string;
  workspaceId: string;
  clientId: string;
  auditRunId: string;
  adAccountId?: string;
};

export type FindingPublic = {
  id: string;
  workspaceId: string;
  clientId: string | null;
  auditRunId: string | null;
  severity: string;
  title: string;
  body: Record<string, unknown>;
  createdAt: string;
};

export type RecommendationPublic = {
  id: string;
  workspaceId: string;
  clientId: string;
  adAccountId: string;
  type: string;
  title: string;
  rationale: string;
  estimatedImpactUsd: string | null;
  risk: string;
  confidence: string | null;
  evidence: Record<string, unknown>;
  proposedMutations: unknown[];
  status: string;
  schemaVersion: string;
  createdAt: string;
};

export type AuditRunPublic = {
  id: string;
  workspaceId: string;
  clientId: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
};

export type AuthorizationPublic = {
  id: string;
  workspaceId: string;
  clientId: string;
  recommendationId: string;
  decisionId: string;
  scope: Record<string, unknown>;
  expiresAt: string | null;
  revokedAt: string | null;
};
