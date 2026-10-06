import { describe, expect, it, vi } from "vitest";
import {
  asConnector,
  bundledCallTrackingConnector,
  callRailConnector,
  clarityAnalyticsConnector,
  CONNECTORS,
  ga4AnalyticsConnector,
  getAdPlatformConnector,
  getCrmConnector,
  getSiteConnector,
  housecallProConnector,
  googleAdPlatformConnector,
  metaAdPlatformConnector,
  mockAdPlatformConnector,
  wordPressSiteConnector,
  type Connector,
} from "@tharros/ads-shared/connectors";
import { defaultCapabilityFlags } from "@tharros/ads-shared";
import { applyViaConnector } from "@tharros/ads-shared/mutate";
import { exchangeCode } from "../src/oauth-exchange";

describe("connector interfaces", () => {
  it("registers Meta, Google, mock, GA4, and CallRail against the same Connector surface", () => {
    const ids = CONNECTORS.map((connector) => connector.id);
    expect(ids).toEqual(["meta", "google", "mock", "ga4", "first_party", "clarity", "callrail", "bundled", "hcp", "wordpress"]);
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
    expect(clarityAnalyticsConnector.implementation).toBe("live");
    expect(clarityAnalyticsConnector.connectCapability).toBe("m52.clarity_connect");
    expect(clarityAnalyticsConnector.capture).toBe(false);
    expect(typeof clarityAnalyticsConnector.pullSessionSignals).toBe("function");
    expect(getSiteConnector("wordpress")).toBe(wordPressSiteConnector);
    expect(wordPressSiteConnector.supportsLandingPageMutation).toBe(false);
    expect(mockAdPlatformConnector.implementation).toBe("mock");
    expect(typeof metaAdPlatformConnector.authorizeUrl).toBe("function");
    expect(typeof metaAdPlatformConnector.pull).toBe("function");
    expect(typeof callRailConnector.pullCalls).toBe("function");
    expect(bundledCallTrackingConnector.implementation).toBe("live");
    expect(bundledCallTrackingConnector.connectCapability).toBe("m52.bundled_call_tracking");
    expect(typeof bundledCallTrackingConnector.pullCalls).toBe("function");
    expect(housecallProConnector.implementation).toBe("live");
    expect(housecallProConnector.connectCapability).toBe("m52.crm_join");
    expect(housecallProConnector.writes).toBe(false);
    expect(typeof housecallProConnector.pullLeadsAndJobs).toBe("function");
    expect(getCrmConnector("hcp")).toBe(housecallProConnector);
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
    const read = vi.spyOn(connector, "readLiveEntityState").mockResolvedValue({
      externalId: "1",
      entityType: "campaign",
      status: "active",
      accountId: "1",
    });
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

    read.mockResolvedValueOnce(null);
    const closed = await applyViaConnector({
      platform: "meta",
      tokens: { accessToken: "tok", mock: false },
      mutation,
      accountExternalId: "act_1",
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(closed.writes).toBe(false);
    expect(closed.status).toBe("failed");
    expect(closed.reason).toBe("Couldn't confirm this on Meta. Nothing was written.");
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

  it("treats a platform 5xx or an unreadable 2xx after send as unconfirmed", async () => {
    const mutation = {
      platform: "meta" as const,
      action: "pause" as const,
      target: { entityType: "campaign", externalId: "1", name: "HVAC" },
      payload: {},
    };
    const live = { externalId: "1", entityType: "campaign", status: "active", accountId: "1" };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 500 }));
    await expect(
      metaAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation,
        live,
        accountExternalId: "act_1",
      }),
    ).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });
    fetchMock.mockResolvedValueOnce(new Response("<html>ok</html>", { status: 200 }));
    await expect(
      metaAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation,
        live,
        accountExternalId: "act_1",
      }),
    ).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 400 }));
    await expect(
      metaAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation,
        live,
        accountExternalId: "act_1",
      }),
    ).rejects.toThrow(/Meta write failed \(400\)/);

    const previous = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer-token";
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    await expect(
      googleAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation: { ...mutation, platform: "google" },
        live,
        accountExternalId: "customers/1",
      }),
    ).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(
      googleAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation: { ...mutation, platform: "google" },
        live,
        accountExternalId: "customers/1",
      }),
    ).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });
    if (previous === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previous;
    fetchMock.mockRestore();
  });

  it("treats a 2xx whose body drops after the headers as unconfirmed", async () => {
    const dropped = () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } }));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    };
    const mutation = {
      action: "create_ad" as const,
      target: { entityType: "adset" as const, externalId: "9001", name: "HVAC" },
      payload: {
        proposedName: "cq-body-drop",
        body: "Hello",
        pageId: "1001",
        link: "https://pilot.example/offer",
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "creative-1" }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(dropped());
    await expect(
      metaAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation: { ...mutation, platform: "meta" },
        live: { externalId: "9001", entityType: "adset", status: "active", accountId: "1" },
        accountExternalId: "act_1",
      }),
    ).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });

    const previous = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer-token";
    fetchMock.mockResolvedValueOnce(dropped());
    await expect(
      googleAdPlatformConnector.applyLive({
        tokens: { accessToken: "tok", mock: false },
        mutation: { ...mutation, platform: "google" },
        live: null,
        accountExternalId: "customers/1",
      }),
    ).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });
    if (previous === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previous;
    fetchMock.mockRestore();
  });
});
