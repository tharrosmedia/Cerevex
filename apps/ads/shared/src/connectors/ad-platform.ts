import { authorizeUrl, isGoogleConfigured, isMetaConfigured } from "../oauth";
import { mockPull, pullAdAccount } from "../platforms";
import type { Platform } from "../types";
import type { AdPlatformConnector, ConnectorConnectInput, ConnectorConnectResult, ConnectorPullInput } from "./types";

function notConfigured(platform: Platform): ConnectorConnectResult {
  return {
    ok: false,
    stub: false,
    connectorId: platform,
    reason: `${platform} OAuth is not configured. Use the mock connector or set app credentials.`,
  };
}

export class MetaAdPlatformConnector implements AdPlatformConnector {
  readonly kind = "ad_platform" as const;
  readonly id = "meta" as const;
  readonly label = "Meta Ads";
  readonly implementation = "live" as const;
  readonly platform = "meta" as const;

  isConfigured(): boolean {
    return isMetaConfigured();
  }

  authorizeUrl(state: string): string {
    return authorizeUrl("meta", state);
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (!this.isConfigured()) return notConfigured("meta");
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      externalId: input.externalId,
      reason: "Use /oauth/meta/start — this implementation does not exchange codes itself.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return { ok: true, stub: false, connectorId: this.id };
  }

  pull(input: ConnectorPullInput) {
    return pullAdAccount({
      platform: "meta",
      tokens: input.tokens,
      externalId: input.externalId,
      clientName: input.clientName,
      allowLive: input.allowLive,
    });
  }
}

export class GoogleAdPlatformConnector implements AdPlatformConnector {
  readonly kind = "ad_platform" as const;
  readonly id = "google" as const;
  readonly label = "Google Ads";
  readonly implementation = "live" as const;
  readonly platform = "google" as const;

  isConfigured(): boolean {
    return isGoogleConfigured();
  }

  authorizeUrl(state: string): string {
    return authorizeUrl("google", state);
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (!this.isConfigured()) return notConfigured("google");
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      externalId: input.externalId,
      reason: "Use /oauth/google/start — this implementation does not exchange codes itself.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return { ok: true, stub: false, connectorId: this.id };
  }

  pull(input: ConnectorPullInput) {
    return pullAdAccount({
      platform: "google",
      tokens: input.tokens,
      externalId: input.externalId,
      clientName: input.clientName,
      allowLive: input.allowLive,
    });
  }
}

export class MockAdPlatformConnector implements AdPlatformConnector {
  readonly kind = "ad_platform" as const;
  readonly id = "mock" as const;
  readonly label = "Mock ads";
  readonly implementation = "mock" as const;
  readonly platform: Platform;

  constructor(platform: Platform = "meta") {
    this.platform = platform;
  }

  isConfigured(): boolean {
    return true;
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
}

export const metaAdPlatformConnector = new MetaAdPlatformConnector();
export const googleAdPlatformConnector = new GoogleAdPlatformConnector();
export const mockAdPlatformConnector = new MockAdPlatformConnector("meta");
