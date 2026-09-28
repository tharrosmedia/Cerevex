import { describe, expect, it } from "vitest";
import {
  IN_MARKET_LOAD_ERROR,
  buildInMarketView,
  cockpitCostPerResultUsd,
  defaultCapabilityFlags,
  inMarketChip,
  resolveAdsNav,
  defaultModulesFor,
} from "@tharros/ads-shared";

describe("in market inventory", () => {
  it("stays hidden until the flag is on and reuses cockpit cost per result", () => {
    expect(defaultCapabilityFlags().in_market).toBe("hidden");
    expect(cockpitCostPerResultUsd("80", "2")).toBe(40);
    const hidden = resolveAdsNav({ shell: "inShell", modules: defaultModulesFor("home_service") });
    expect(hidden.some((item) => item.id === "in_market")).toBe(false);
    const shown = resolveAdsNav({
      shell: "inShell",
      modules: defaultModulesFor("home_service"),
      capabilities: { ...defaultCapabilityFlags(), in_market: "on" },
    });
    expect(shown.find((item) => item.id === "in_market")?.href).toBe("/ads/in-market");
    expect(inMarketChip("PAUSED").label).toBe("Paused");
  });

  it("keeps recently paused rows and drops long-paused ones", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    const view = buildInMarketView({
      now,
      accounts: [
        {
          id: "meta-1",
          platform: "meta",
          externalId: "act_100",
          displayName: "Meta",
          connectionStatus: "connected",
          lastSyncAt: "2026-09-28T11:00:00.000Z",
          hasCredentials: true,
        },
      ],
      entities: [
        {
          id: "live",
          adAccountId: "meta-1",
          platform: "meta",
          entityType: "campaign",
          externalId: "1",
          name: "Live",
          status: "active",
          syncedAt: "2026-09-28T11:00:00.000Z",
        },
        {
          id: "recent",
          adAccountId: "meta-1",
          platform: "meta",
          entityType: "campaign",
          externalId: "2",
          name: "Recent pause",
          status: "paused",
          syncedAt: "2026-08-01T00:00:00.000Z",
          raw: { updated_time: "2026-09-27T00:00:00.000Z" },
        },
        {
          id: "old",
          adAccountId: "meta-1",
          platform: "meta",
          entityType: "campaign",
          externalId: "3",
          name: "Old pause",
          status: "paused",
          syncedAt: "2026-09-28T11:00:00.000Z",
          raw: { updated_time: "2026-08-01T00:00:00.000Z" },
        },
      ],
      metrics: [],
    });
    expect(view.platforms[0]?.accounts[0]?.campaigns.map((row) => row.name)).toEqual(["Live", "Recent pause"]);
    expect(view.platforms[0]?.accounts[0]?.campaigns.find((row) => row.name === "Recent pause")?.chip).toBe("Paused");
    expect(view.platforms[0]?.staleLabel).toBe("Last updated 1 hour ago.");
    expect(IN_MARKET_LOAD_ERROR).toBe("Couldn't load live inventory. Try again.");
  });
});
