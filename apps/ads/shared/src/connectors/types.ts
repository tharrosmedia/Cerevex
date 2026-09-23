/**
 * Browser-safe connector contracts. Implementations may be Node-only
 * (`@tharros/ads-shared/connectors`) and must not be imported from ads-web pages.
 */

import type {
  AdPlatformConnectorId,
  AnalyticsConnectorId,
  CallTrackingConnectorId,
  CapabilityFlags,
  CapabilityId,
  ConnectorImplementation,
  ConnectorKind,
  CrmConnectorId,
  SiteConnectorId,
} from "@cerevex/contracts";
import type { ApplyMutation } from "../audit-schemas";
import type { BookedJob, CallRecord } from "../attribution";
import type { CrmLead } from "../lead-lifecycle";
import type { AggregatedSessionSignal } from "../lp-intelligence";
import type { LiveEntityState, MutationOutcome } from "../mutate-types";
import type { PullResult } from "../platforms";
import type { Platform, StoredOAuthTokens } from "../types";

export type ConnectorConnectInput = {
  workspaceId: string;
  clientId?: string;
  externalId?: string;
  label?: string;
  apiKey?: string;
  projectId?: string;
  accountId?: string;
  companyId?: string;
  accountSid?: string;
  authToken?: string;
  trackingNumber?: string;
  campaignLabel?: string;
  /** Live number purchase / routing writes are refused. */
  purchaseNumber?: boolean;
  voiceUrl?: string;
  mock?: boolean;
  useEnv?: boolean;
};

export type ConnectorConnectResult = {
  ok: boolean;
  stub: boolean;
  connectorId: string;
  reason?: string;
  externalId?: string;
  mock?: boolean;
  trackingNumber?: string;
  purchased?: false;
  routingChanged?: false;
  capture?: false;
};

export type CallTrackingPullInput = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  accountId?: string;
  apiKey?: string;
  accountSid?: string;
  authToken?: string;
  trackingNumber?: string;
  campaignLabel?: string;
  mock?: boolean;
};

export type CallTrackingPullResult = {
  ok: boolean;
  mock: boolean;
  connectorId: string;
  calls: CallRecord[];
  reason?: string;
};

export type CrmJoinInput = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  apiKey?: string;
  mock?: boolean;
};

export type CrmJoinResult = {
  ok: boolean;
  stub: boolean;
  connectorId: string;
  mock: boolean;
  bookedJobs: BookedJob[];
  writes: false;
  reason?: string;
};

export type CrmPullInput = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  apiKey?: string;
  mock?: boolean;
};

export type CrmPullResult = {
  ok: boolean;
  stub: boolean;
  connectorId: string;
  mock: boolean;
  bookedJobs: BookedJob[];
  leads: CrmLead[];
  writes: false;
  reason?: string;
};

export type SessionSignalsPullInput = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  projectId?: string;
  apiKey?: string;
  mock?: boolean;
};

export type SessionSignalsPullResult = {
  ok: boolean;
  mock: boolean;
  connectorId: string;
  signals: AggregatedSessionSignal[];
  sessionCount: number;
  writes: false;
  capture: false;
  reason?: string;
};

export type ConnectorPullInput = {
  platform: Platform;
  tokens: StoredOAuthTokens;
  externalId: string;
  clientName: string;
  allowLive: boolean;
};

export type ConnectorExchangeResult = {
  tokens: StoredOAuthTokens;
  externalId: string;
};

export type ConnectorApplyInput = {
  tokens: StoredOAuthTokens;
  mutation: ApplyMutation;
  live: LiveEntityState | null;
  accountExternalId: string;
};

/**
 * Shared surface Meta connect and stub CallRail both compile against.
 * Extra methods live on the kind-specific interfaces.
 */
export interface Connector {
  readonly kind: ConnectorKind;
  readonly id: string;
  readonly label: string;
  readonly implementation: ConnectorImplementation;
  isConfigured(): boolean;
  connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult>;
  disconnect(input: ConnectorConnectInput): Promise<ConnectorConnectResult>;
}

export interface AdPlatformConnector extends Connector {
  readonly kind: "ad_platform";
  readonly id: AdPlatformConnectorId;
  readonly platform: Platform;
  readonly connectCapability: Extract<CapabilityId, "connect.meta" | "connect.google">;
  authorizeUrl(state: string): string;
  isLiveAllowed(tokens?: StoredOAuthTokens | null, flags?: CapabilityFlags): boolean;
  pull(input: ConnectorPullInput): Promise<PullResult>;
  refreshTokens(tokens: StoredOAuthTokens): Promise<StoredOAuthTokens>;
  exchangeCode(code: string): Promise<ConnectorExchangeResult>;
  readLiveEntityState(input: {
    tokens: StoredOAuthTokens;
    mutation: ApplyMutation;
  }): Promise<LiveEntityState | null>;
  applyLive(input: ConnectorApplyInput): Promise<MutationOutcome>;
}

export interface AnalyticsConnector extends Connector {
  readonly kind: "analytics";
  readonly id: AnalyticsConnectorId;
  readonly connectCapability?: Extract<CapabilityId, "m51.ga4_connect" | "m52.clarity_connect">;
  readonly capture?: false;
  pullSessionSignals?(input: SessionSignalsPullInput): Promise<SessionSignalsPullResult>;
}

export interface CallTrackingConnector extends Connector {
  readonly kind: "call_tracking";
  readonly id: CallTrackingConnectorId;
  readonly mode: "connect" | "bundled";
  readonly connectCapability?: Extract<CapabilityId, "m52.callrail_connect" | "m52.bundled_call_tracking">;
  pullCalls?(input: CallTrackingPullInput): Promise<CallTrackingPullResult>;
}

export interface CrmConnector extends Connector {
  readonly kind: "crm";
  readonly id: CrmConnectorId;
  readonly connectCapability?: Extract<CapabilityId, "m52.crm_join">;
  readonly writes: false;
  listBookedJobs(input: CrmJoinInput): Promise<CrmJoinResult>;
  pullLeadsAndJobs(input: CrmPullInput): Promise<CrmPullResult>;
}

export interface SiteConnector extends Connector {
  readonly kind: "site";
  readonly id: SiteConnectorId;
  readonly connectCapability?: Extract<CapabilityId, "m52.lp_intelligence">;
  readonly supportsLandingPageMutation: boolean;
}

export type AnyConnector =
  | AdPlatformConnector
  | AnalyticsConnector
  | CallTrackingConnector
  | CrmConnector
  | SiteConnector;
