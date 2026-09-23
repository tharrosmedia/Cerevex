import type {
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

export const callRailConnector = new StubCallTrackingConnector("callrail", "CallRail", "connect");
export const bundledCallTrackingConnector = new StubCallTrackingConnector("bundled", "Bundled call tracking", "bundled");
