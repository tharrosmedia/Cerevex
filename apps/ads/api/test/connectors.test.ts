import { describe, expect, it, vi } from "vitest";
import {
  asConnector,
  callRailConnector,
  CONNECTORS,
  ga4AnalyticsConnector,
  getAdPlatformConnector,
  googleAdPlatformConnector,
  metaAdPlatformConnector,
  mockAdPlatformConnector,
  type Connector,
} from "@tharros/ads-shared/connectors";
import { defaultCapabilityFlags } from "@tharros/ads-shared";
import { applyViaConnector } from "@tharros/ads-shared/mutate";
import { exchangeCode } from "../src/oauth-exchange";

describe("connector interfaces", () => {
  it("registers Meta, Google, mock, GA4, and CallRail against the same Connector surface", () => {
    const ids = CONNECTORS.map((connector) => connector.id);
    expect(ids).toEqual(["meta", "google", "mock", "ga4", "first_party", "callrail", "bundled", "hcp"]);
    for (const connector of CONNECTORS) {
      const shared: Connector = asConnector(connector);
      expect(typeof shared.isConfigured).toBe("function");
      expect(typeof shared.connect).toBe("function");
      expect(typeof shared.disconnect).toBe("function");
    }
  });

  it("lets Meta connect and CallRail mock-connect against the same Connector surface", async () => {
    const pair: Connector[] = [metaAdPlatformConnector, callRailConnector];
    const meta = await pair[0]!.connect({ workspaceId: "ws", clientId: "client" });
    const callrail = await pair[1]!.connect({ workspaceId: "ws", mock: true });
    expect(meta.connectorId).toBe("meta");
    expect(callrail.ok).toBe(true);
    expect(callrail.stub).toBe(false);
    expect(callrail.mock).toBe(true);
    expect(callRailConnector.implementation).toBe("live");
    expect(callRailConnector.connectCapability).toBe("m52.callrail_connect");
    expect(ga4AnalyticsConnector.implementation).toBe("live");
    expect(mockAdPlatformConnector.implementation).toBe("mock");
    expect(typeof metaAdPlatformConnector.authorizeUrl).toBe("function");
    expect(typeof metaAdPlatformConnector.pull).toBe("function");
    expect(typeof callRailConnector.pullCalls).toBe("function");
  });

  it("refuses live pull when sync.live is hidden even if tokens look live", () => {
    const flags = { ...defaultCapabilityFlags(), "sync.live": "hidden" as const };
    expect(metaAdPlatformConnector.isLiveAllowed({ accessToken: "tok", mock: false }, flags)).toBe(false);
    expect(googleAdPlatformConnector.isLiveAllowed({ accessToken: "tok", mock: false }, flags)).toBe(false);
    expect(metaAdPlatformConnector.isLiveAllowed({ accessToken: "tok", mock: true }, defaultCapabilityFlags())).toBe(
      false,
    );
  });

  it("exposes pull, mutate, refresh, and exchange on Meta/Google connectors", () => {
    for (const connector of [metaAdPlatformConnector, googleAdPlatformConnector]) {
      expect(connector.connectCapability).toMatch(/^connect\.(meta|google)$/);
      expect(typeof connector.pull).toBe("function");
      expect(typeof connector.refreshTokens).toBe("function");
      expect(typeof connector.exchangeCode).toBe("function");
      expect(typeof connector.readLiveEntityState).toBe("function");
      expect(typeof connector.applyLive).toBe("function");
      expect(typeof connector.isLiveAllowed).toBe("function");
    }
    expect(getAdPlatformConnector("meta")).toBe(metaAdPlatformConnector);
    expect(getAdPlatformConnector("google")).toBe(googleAdPlatformConnector);
  });

  it("pulls mock entities through getAdPlatformConnector without a live platform call", async () => {
    const pulled = await getAdPlatformConnector("google").pull({
      platform: "google",
      tokens: { accessToken: "not-live", mock: true },
      externalId: "customers/mock",
      clientName: "Pilot",
      allowLive: true,
    });
    expect(pulled.mode).toBe("mock");
    expect(pulled.entities.some((entity) => entity.entityType === "campaign")).toBe(true);
    expect(pulled.entities.some((entity) => entity.entityType === "keyword")).toBe(true);
  });

  it("routes live apply through the registry connector", async () => {
    const connector = getAdPlatformConnector("meta");
    const mutation = {
      platform: "meta" as const,
      action: "pause" as const,
      target: { entityType: "campaign", externalId: "1", name: "HVAC" },
      payload: {},
    };
    const read = vi.spyOn(connector, "readLiveEntityState").mockResolvedValue(null);
    const apply = vi.spyOn(connector, "applyLive").mockResolvedValue({
      action: "pause",
      platform: "meta",
      target: mutation.target,
      status: "applied",
      mode: "live",
      writes: true,
    });
    const outcome = await applyViaConnector({
      platform: "meta",
      tokens: { accessToken: "tok", mock: false },
      mutation,
      accountExternalId: "act_1",
    });
    expect(read).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(outcome.mode).toBe("live");
    expect(outcome.writes).toBe(true);
    read.mockRestore();
    apply.mockRestore();
  });

  it("dispatches OAuth exchange through the connector registry", async () => {
    const connector = getAdPlatformConnector("google");
    const exchange = vi.spyOn(connector, "exchangeCode").mockResolvedValue({
      tokens: { accessToken: "live-token", mock: false },
      externalId: "customers/1",
    });
    const result = await exchangeCode("google", "auth-code");
    expect(exchange).toHaveBeenCalledWith("auth-code");
    expect(result.externalId).toBe("customers/1");
    exchange.mockRestore();
  });
});
