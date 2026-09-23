import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAccount } from "@tharros/ads-shared/audit-engine";
import { recommendationDraftSchema } from "@tharros/ads-shared/audit-schemas";
import { mockBundledCalls, mockHcpBookedJobs, summarizeAttribution } from "@tharros/ads-shared/attribution";
import {
  readConnectorSettings,
  resolveCallTrackingForClient,
} from "@tharros/ads-shared/connector-settings";
import {
  bundledCallTrackingConnector,
  callRailConnector,
  getCallTrackingConnector,
} from "@tharros/ads-shared/connectors";
import { defaultCapabilityFlags, mockPull } from "@tharros/ads-shared";
import { filterOfflineRecommendations } from "../src/offline";

describe("M5.2 bundled call tracking (Twilio-class lean)", () => {
  it("registers a live bundled connector behind the same CallTrackingConnector surface", () => {
    const connector = getCallTrackingConnector("bundled");
    expect(connector).toBe(bundledCallTrackingConnector);
    expect(connector.implementation).toBe("live");
    expect(connector.mode).toBe("bundled");
    expect(connector.connectCapability).toBe("m52.bundled_call_tracking");
    expect(typeof connector.pullCalls).toBe("function");
    expect(callRailConnector.connectCapability).toBe("m52.callrail_connect");
  });

  it("mock-connects, pulls calls, and never writes routing or numbers", async () => {
    const connected = await bundledCallTrackingConnector.connect({
      workspaceId: "ws",
      clientId: "c",
      mock: true,
    });
    expect(connected.ok).toBe(true);
    expect(connected.stub).toBe(false);
    expect(connected.mock).toBe(true);
    expect(connected.purchased).toBe(false);
    expect(connected.routingChanged).toBe(false);
    expect(connected.trackingNumber).toBeTruthy();

    const pulled = await bundledCallTrackingConnector.pullCalls({
      workspaceId: "ws",
      clientId: "c",
      clientName: "KC Prestige",
      mock: true,
    });
    expect(pulled.ok).toBe(true);
    expect(pulled.mock).toBe(true);
    expect(pulled.calls.length).toBeGreaterThan(0);
    expect(pulled.calls.every((row) => row.source === "Bundled")).toBe(true);
  });

  it("refuses unsupervised number purchase and routing writes", async () => {
    const buy = await bundledCallTrackingConnector.connect({
      workspaceId: "ws",
      purchaseNumber: true,
      accountSid: "ACxxxx",
      authToken: "secret",
    });
    expect(buy.ok).toBe(false);
    expect(buy.purchased).toBe(false);
    expect(buy.reason).toMatch(/will not buy/i);

    const route = await bundledCallTrackingConnector.connect({
      workspaceId: "ws",
      voiceUrl: "https://example.test/voice",
      accountSid: "ACxxxx",
      authToken: "secret",
    });
    expect(route.ok).toBe(false);
    expect(route.routingChanged).toBe(false);
    expect(route.reason).toMatch(/routing/i);
  });

  it("joins mock bundled calls to campaigns in plain language", () => {
    const pulled = mockPull("google", "KC Prestige");
    const summary = summarizeAttribution({
      calls: mockBundledCalls("KC Prestige"),
      campaigns: pulled.entities
        .filter((entity) => entity.entityType === "campaign")
        .map((entity) => ({ ...entity, platform: "google" as const })),
      bookedJobs: mockHcpBookedJobs("KC Prestige"),
      crmEnabled: true,
      sourceLabel: "bundled call tracking",
    });
    expect(summary.answeredCount).toBeGreaterThan(0);
    expect(summary.joins.some((row) => row.matchedOn === "campaign")).toBe(true);
    expect(summary.joins.some((row) => row.matchedOn === "unmatched")).toBe(true);
    expect(summary.sentences.join(" ")).not.toMatch(/roas|cpa|cpc/i);
    expect(summary.sentences.join(" ")).toMatch(/joined to campaign/i);
    expect(summary.sentences.join(" ")).toMatch(/bundled call tracking/i);
  });

  it("emits recommend-only call_attribution recs when bundled is enabled", () => {
    const pulled = mockPull("meta", "KC Prestige");
    const result = evaluateAccount({
      workspaceId: randomUUID(),
      clientId: randomUUID(),
      auditRunId: randomUUID(),
      adAccountId: randomUUID(),
      platform: "meta",
      entities: pulled.entities,
      metrics: pulled.metrics,
      offlineSignals: {
        calls: mockBundledCalls("KC Prestige"),
        bookedJobs: mockHcpBookedJobs("KC Prestige"),
        callrailEnabled: false,
        bundledEnabled: true,
        crmEnabled: true,
        sourceLabel: "bundled call tracking",
      },
    });
    const callRec = result.recommendations.find((row) => row.type === "call_attribution");
    expect(callRec).toBeTruthy();
    expect(recommendationDraftSchema.safeParse(callRec).success).toBe(true);
    expect(callRec?.evidenceJson.writes).toBe(false);
    expect(callRec?.evidenceJson.source).toBe("bundled");
    expect(callRec?.proposedMutationsJson.every((row) => row.execute === false)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("\"execute\":true");
  });

  it("does not emit call recs when bundled and CallRail are both off", () => {
    const pulled = mockPull("meta", "KC Prestige");
    const result = evaluateAccount({
      workspaceId: randomUUID(),
      clientId: randomUUID(),
      auditRunId: randomUUID(),
      adAccountId: randomUUID(),
      platform: "meta",
      entities: pulled.entities,
      metrics: pulled.metrics,
      offlineSignals: {
        calls: mockBundledCalls("KC Prestige"),
        bundledEnabled: false,
        callrailEnabled: false,
        crmEnabled: false,
      },
    });
    expect(result.recommendations.some((row) => row.type === "call_attribution")).toBe(false);
    expect(result.findings.some((row) => row.bodyJson.ruleId === "account_snapshot")).toBe(true);
  });

  it("shows call_attribution when only the bundled flag is visible", () => {
    const flags = defaultCapabilityFlags();
    const rows = [{ type: "pause_waste" }, { type: "call_attribution" }, { type: "crm_booked_job" }];
    expect(filterOfflineRecommendations(rows, flags).map((row) => row.type)).toEqual(["pause_waste"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.bundled_call_tracking": "on" }).map((row) => row.type),
    ).toEqual(["pause_waste", "call_attribution"]);
  });

  it("prefers CallRail over bundled so Connect customers stay on Phase A", () => {
    const flags = {
      ...defaultCapabilityFlags(),
      "m52.callrail_connect": "on" as const,
      "m52.bundled_call_tracking": "on" as const,
    };
    const connectors = readConnectorSettings({
      connectors: {
        callrail: {
          "client-1": {
            connected: true,
            mock: true,
            accountId: "cr",
            snapshot: {
              pulledAt: "2026-09-23T00:00:00.000Z",
              mock: true,
              calls: [{ id: "cr-1", startTime: "t", answered: true, durationSeconds: 10, source: "CallRail", campaign: "A" }],
            },
          },
        },
        bundled: {
          "client-1": {
            connected: true,
            mock: true,
            accountSid: "AC",
            snapshot: {
              pulledAt: "2026-09-23T00:00:00.000Z",
              mock: true,
              calls: [{ id: "bd-1", startTime: "t", answered: true, durationSeconds: 10, source: "Bundled", campaign: "B" }],
            },
          },
        },
      },
    });
    const resolved = resolveCallTrackingForClient(connectors, "client-1", flags);
    expect(resolved.source).toBe("callrail");
    expect(resolved.calls[0]?.id).toBe("cr-1");
  });

  it("defaults the bundled capability hidden without breaking core cockpit", () => {
    const flags = defaultCapabilityFlags();
    expect(flags["m52.bundled_call_tracking"]).toBe("hidden");
    expect(flags["m52.callrail_connect"]).toBe("hidden");
    expect(flags.cockpit).toBe("on");
    expect(flags.apply).toBe("on");
    expect(flags.audits).toBe("on");
  });
});
