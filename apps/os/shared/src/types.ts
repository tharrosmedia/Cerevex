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
  hasCredentials: boolean;
  mock: boolean;
  scopes: string[];
};

export type AdEntityPublic = {
  id: string;
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId: string | null;
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
};

export type HealthStatus = {
  ok: boolean;
  service: string;
  version: string;
  time: string;
  checks: Record<string, "ok" | "degraded" | "down">;
};

/**
 * Plan 1.5 event names.
 * Platform-specific paid jobs use meta/ads/* and google/ads/*.
 * Shared OS orchestration uses os/*. Brain seo/* is untouched.
 */
export const EVENTS = {
  stubPing: "os/stub.ping",
  stubSync: "os/stub.sync",
  metaAdsAccountSync: "meta/ads/account.sync",
  googleAdsAccountSync: "google/ads/account.sync",
  applyRequested: "os/apply.requested",
} as const;

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
};
