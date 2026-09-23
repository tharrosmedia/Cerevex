import type { ApplyMutation } from "../audit-schemas";
import type { LiveEntityState, MutationOutcome } from "../mutate-types";
import { mockPull } from "../platforms";
import type { Platform, StoredOAuthTokens } from "../types";
import type {
  AdPlatformConnector,
  ConnectorApplyInput,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorExchangeResult,
  ConnectorPullInput,
} from "./types";

export class MockAdPlatformConnector implements AdPlatformConnector {
  readonly kind = "ad_platform" as const;
  readonly id = "mock" as const;
  readonly label = "Mock ads";
  readonly implementation = "mock" as const;
  readonly platform: Platform;
  readonly connectCapability: AdPlatformConnector["connectCapability"];

  constructor(platform: Platform = "meta") {
    this.platform = platform;
    this.connectCapability = platform === "meta" ? "connect.meta" : "connect.google";
  }

  isConfigured(): boolean {
    return true;
  }

  isLiveAllowed(_tokens?: StoredOAuthTokens | null): boolean {
    return false;
  }

  authorizeUrl(_state: string): string {
    return "";
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    const slug = (input.label ?? input.clientId ?? "pilot").toLowerCase().replace(/\s+/g, "-");
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      externalId: this.platform === "meta" ? `act_mock-${slug}` : `customers/mock-${slug}`,
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return { ok: true, stub: false, connectorId: this.id };
  }

  async pull(input: ConnectorPullInput) {
    return mockPull(input.platform, input.clientName);
  }

  async refreshTokens(tokens: StoredOAuthTokens): Promise<StoredOAuthTokens> {
    return tokens;
  }

  async exchangeCode(_code: string): Promise<ConnectorExchangeResult> {
    return {
      tokens: {
        accessToken: "mock-access-not-a-real-token",
        refreshToken: "mock-refresh-not-a-real-token",
        mock: true,
        scopes: [],
      },
      externalId: this.platform === "meta" ? "act_mock-pending" : "customers/mock-pending",
    };
  }

  async readLiveEntityState(_input: {
    tokens: StoredOAuthTokens;
    mutation: ApplyMutation;
  }): Promise<LiveEntityState | null> {
    return null;
  }

  async applyLive(input: ConnectorApplyInput): Promise<MutationOutcome> {
    return {
      action: input.mutation.action,
      platform: input.mutation.platform,
      target: input.mutation.target,
      status: "failed",
      mode: "mock",
      writes: false,
      reason: "Mock connector does not live-write platforms.",
    };
  }
}

export const mockAdPlatformConnector = new MockAdPlatformConnector("meta");
