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
} from "@shopify-brain/contracts";
import type { ApplyMutation } from "../audit-schemas";
import type { LiveEntityState, MutationOutcome } from "../mutate-types";
import type { PullResult } from "../platforms";
import type { Platform, StoredOAuthTokens } from "../types";

export type ConnectorConnectInput = {
  workspaceId: string;
  clientId?: string;
  externalId?: string;
  label?: string;
};

export type ConnectorConnectResult = {
  ok: boolean;
  stub: boolean;
  connectorId: string;
  reason?: string;
  externalId?: string;
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
}

export interface CallTrackingConnector extends Connector {
  readonly kind: "call_tracking";
  readonly id: CallTrackingConnectorId;
  readonly mode: "connect" | "bundled";
}

export type AnyConnector = AdPlatformConnector | AnalyticsConnector | CallTrackingConnector;
