import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAccount } from "@tharros/ads-shared/audit-engine";
import { recommendationDraftSchema } from "@tharros/ads-shared/audit-schemas";
import { defaultCapabilityFlags } from "@tharros/ads-shared";
import {
  clarityAnalyticsConnector,
  getAnalyticsConnector,
  getDefaultSiteConnector,
  getSiteConnector,
  signalsFromClarityInsights,
} from "@tharros/ads-shared/connectors";
import {
  mockClaritySignals,
  recsFromSessionSignals,
  siteApplyBlockedReason,
  siteLandingPageApplySupported,
} from "@tharros/ads-shared";
import { readConnectorSettings } from "@tharros/ads-shared/connector-settings";
import { filterOfflineRecommendations } from "../src/offline";

function accountInput(extra: Record<string, unknown> = {}) {
  return {
    workspaceId: randomUUID(),
    clientId: randomUUID(),
    auditRunId: randomUUID(),
    adAccountId: randomUUID(),
    platform: "google" as const,
    entities: [
      {
        entityType: "campaign",
        externalId: "camp-1",
        name: "Quote campaign",
        status: "active",
      },
    ],
    metrics: [
      {
        entityExternalId: "camp-1",
        entityType: "campaign",
        window: "30d",
        spendUsd: "120.00",
        impressions: 2000,
        clicks: 80,
        conversions: "4",
      },
    ],
    ...extra,
  };
}

describe("M5.2 Phase C Clarity + LP intelligence", () => {
  it("registers Clarity on the analytics connector surface without an in-house recorder", () => {
    const connector = getAnalyticsConnector("clarity");
    expect(connector).toBe(clarityAnalyticsConnector);
    expect(connector.kind).toBe("analytics");
    expect(connector.implementation).toBe("live");
    expect(connector.capture).toBe(false);
    expect(typeof connector.pullSessionSignals).toBe("function");
  });

  it("mock-connects and pulls aggregated signals only", async () => {
    const connected = await clarityAnalyticsConnector.connect({
      workspaceId: "ws",
      clientId: "c",
      mock: true,
    });
    expect(connected.ok).toBe(true);
    expect(connected.stub).toBe(false);
    expect(connected.mock).toBe(true);
    expect(connected.capture).toBe(false);
    expect(connected.reason).toMatch(/no in-house recorder/i);

    const pulled = await clarityAnalyticsConnector.pullSessionSignals({
      workspaceId: "ws",
      clientId: "c",
      clientName: "Elmar HVAC",
      mock: true,
    });
    expect(pulled.ok).toBe(true);
    expect(pulled.mock).toBe(true);
    expect(pulled.writes).toBe(false);
    expect(pulled.capture).toBe(false);
    expect(pulled.signals.map((row) => row.kind)).toEqual(["hero", "structure", "copy", "wizard"]);
    expect(pulled.signals.every((row) => row.why.length > 20)).toBe(true);
    expect(JSON.stringify(pulled.signals)).not.toMatch(/recording|replay|visitorId|email|phone/i);
  });

  it("refuses live connect without a token and never claims capture", async () => {
    const missing = await clarityAnalyticsConnector.connect({
      workspaceId: "ws",
      clientId: "c",
    });
    expect(missing.ok).toBe(false);
    expect(missing.capture).toBe(false);
    expect(missing.reason).toMatch(/mock connect/i);
  });

  it("maps Clarity live insights to aggregated signals without PII", () => {
    const mapped = signalsFromClarityInsights(
      [
        {
          metricName: "Traffic",
          information: [{ totalSessionCount: "240", PagesPerSessionPercentage: 1.1 }],
        },
        {
          metricName: "Engagement",
          information: [{ activeTime: "12", documentTitle: "Get a quote", url: "https://elmar.test/quote" }],
        },
      ],
      "Elmar HVAC",
    );
    expect(mapped.sessionCount).toBe(240);
    expect(mapped.signals.some((row) => row.kind === "structure")).toBe(true);
    expect(mapped.signals.some((row) => row.kind === "hero")).toBe(true);
    expect(mapped.signals.some((row) => row.kind === "wizard")).toBe(true);
    expect(JSON.stringify(mapped.signals)).not.toMatch(/cookie|ipAddress|email/i);
  });

  it("Site connector cannot mutate landing pages — recs stay Site apply later", () => {
    const site = getSiteConnector("wordpress");
    expect(site).toBe(getDefaultSiteConnector());
    expect(site.supportsLandingPageMutation).toBe(false);
    expect(siteLandingPageApplySupported(site)).toBe(false);
    expect(siteApplyBlockedReason(site, "lp_intelligence")).toBe("site_apply_later");
    expect(siteApplyBlockedReason(site, "budget_shift")).toBeNull();

    const drafts = recsFromSessionSignals(mockClaritySignals("Elmar HVAC"), site);
    expect(drafts).toHaveLength(4);
    expect(drafts.every((row) => row.siteApply === "later")).toBe(true);
    expect(drafts.every((row) => /site apply later/i.test(row.rationale))).toBe(true);
  });

  it("emits recommend-only lp_intelligence recs when the flag is on and signals exist", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          lpIntelligenceEnabled: true,
          lpSignals: mockClaritySignals("Elmar HVAC"),
        },
      }),
    );
    const recs = result.recommendations.filter((row) => row.type === "lp_intelligence");
    expect(recs).toHaveLength(4);
    for (const rec of recs) {
      expect(recommendationDraftSchema.safeParse(rec).success).toBe(true);
      expect(rec.rationale).toMatch(/site apply later/i);
      expect(rec.evidenceJson.writes).toBe(false);
      expect(rec.evidenceJson.siteApply).toBe("later");
      expect(rec.evidenceJson.capture).toBe(false);
      expect(rec.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
    }
    expect(result.findings.some((row) => row.bodyJson.ruleId === "lp_intelligence")).toBe(true);
  });

  it("does not emit LP recs when the capability is off", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          lpIntelligenceEnabled: false,
          lpSignals: mockClaritySignals("Elmar HVAC"),
        },
      }),
    );
    expect(result.recommendations.some((row) => row.type === "lp_intelligence")).toBe(false);
  });

  it("hides lp_intelligence recs when the flag is hidden", () => {
    const flags = defaultCapabilityFlags();
    const rows = [{ type: "pause_waste" }, { type: "lp_intelligence" }, { type: "call_attribution" }];
    expect(filterOfflineRecommendations(rows, flags).map((row) => row.type)).toEqual(["pause_waste"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.lp_intelligence": "on" }).map((row) => row.type),
    ).toEqual(["pause_waste", "lp_intelligence"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.lp_intelligence": "recommend_only" }).map((row) => row.type),
    ).toEqual(["pause_waste", "lp_intelligence"]);
  });

  it("stores Clarity snapshots in settings_json without an ALTER", () => {
    const settings = readConnectorSettings({
      connectors: {
        clarity: {},
      },
    });
    expect(settings.clarity).toEqual({});

    const loaded = readConnectorSettings({
      connectors: {
        clarity: {
          "11111111-1111-1111-1111-111111111111": {
            connected: true,
            mock: true,
            projectId: "mock-clarity",
            snapshot: {
              pulledAt: "2026-09-23T00:00:00.000Z",
              mock: true,
              projectId: "mock-clarity",
              sessionCount: 420,
              signals: mockClaritySignals("Pilot"),
              capture: false,
              writes: false,
            },
          },
        },
      },
    });
    expect(loaded.clarity["11111111-1111-1111-1111-111111111111"]?.connected).toBe(true);
    expect(loaded.clarity["11111111-1111-1111-1111-111111111111"]?.snapshot?.signals).toHaveLength(4);
    expect(loaded.callrail).toEqual({});
  });
});
