import type {
  AnalyticsConnector,
  CallTrackingConnector,
  ConnectorConnectInput,
  ConnectorConnectResult,
} from "./types";

function stubResult(
  connectorId: string,
  ok: boolean,
  reason: string,
): ConnectorConnectResult {
  return { ok, stub: true, connectorId, reason };
}

class StubAnalyticsConnector implements AnalyticsConnector {
  readonly kind = "analytics" as const;
  readonly implementation = "stub" as const;
  readonly id: AnalyticsConnector["id"];
  readonly label: string;

  constructor(id: AnalyticsConnector["id"], label: string) {
    this.id = id;
    this.label = label;
  }

  isConfigured(): boolean {
    return false;
  }

  async connect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return stubResult(this.id, true, `${this.label} is a compile-time stub. No analytics product work in this retrofit.`);
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return stubResult(this.id, true, `${this.label} stub disconnect. Nothing was stored.`);
  }
}

class StubCallTrackingConnector implements CallTrackingConnector {
  readonly kind = "call_tracking" as const;
  readonly implementation = "stub" as const;
  readonly id: CallTrackingConnector["id"];
  readonly label: string;
  readonly mode: "connect" | "bundled";

  constructor(id: CallTrackingConnector["id"], label: string, mode: "connect" | "bundled") {
    this.id = id;
    this.label = label;
    this.mode = mode;
  }

  isConfigured(): boolean {
    return false;
  }

  async connect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return stubResult(
      this.id,
      true,
      `${this.label} is a compile-time stub (${this.mode}). No CallRail product work in this retrofit.`,
    );
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return stubResult(this.id, true, `${this.label} stub disconnect. Nothing was stored.`);
  }
}

export const ga4AnalyticsConnector = new StubAnalyticsConnector("ga4", "GA4");
export const firstPartyAnalyticsConnector = new StubAnalyticsConnector("first_party", "First-party events");
export const callRailConnector = new StubCallTrackingConnector("callrail", "CallRail", "connect");
export const bundledCallTrackingConnector = new StubCallTrackingConnector("bundled", "Bundled call tracking", "bundled");
