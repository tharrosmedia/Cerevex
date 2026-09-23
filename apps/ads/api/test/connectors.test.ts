import { describe, expect, it } from "vitest";
import {
  asConnector,
  callRailConnector,
  CONNECTORS,
  ga4AnalyticsConnector,
  metaAdPlatformConnector,
  mockAdPlatformConnector,
  type Connector,
} from "@tharros/ads-shared/connectors";

describe("connector interfaces", () => {
  it("registers Meta, Google, mock, GA4, and CallRail against the same Connector surface", () => {
    const ids = CONNECTORS.map((connector) => connector.id);
    expect(ids).toEqual(["meta", "google", "mock", "ga4", "first_party", "callrail", "bundled"]);
    for (const connector of CONNECTORS) {
      const shared: Connector = asConnector(connector);
      expect(typeof shared.isConfigured).toBe("function");
      expect(typeof shared.connect).toBe("function");
      expect(typeof shared.disconnect).toBe("function");
    }
  });

  it("lets Meta connect and stub CallRail compile and run against Connector", async () => {
    const pair: Connector[] = [metaAdPlatformConnector, callRailConnector];
    const meta = await pair[0]!.connect({ workspaceId: "ws", clientId: "client" });
    const callrail = await pair[1]!.connect({ workspaceId: "ws" });
    expect(meta.connectorId).toBe("meta");
    expect(callrail.ok).toBe(true);
    expect(callrail.stub).toBe(true);
    expect(callrail.reason).toMatch(/stub/i);
    expect(ga4AnalyticsConnector.implementation).toBe("stub");
    expect(mockAdPlatformConnector.implementation).toBe("mock");
    expect(typeof metaAdPlatformConnector.authorizeUrl).toBe("function");
    expect(typeof metaAdPlatformConnector.pull).toBe("function");
  });
});
