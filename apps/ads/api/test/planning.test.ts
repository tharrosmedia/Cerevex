import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAccount } from "@tharros/ads-shared/audit-engine";
import { recommendationDraftSchema } from "@tharros/ads-shared/audit-schemas";
import {
  buildWeeklyNarrative,
  classifyWindows,
  defaultCapabilityFlags,
  defaultSeasonalityCalendar,
  mockPull,
  ownerWeeklyNarrativeWriteBlockedReason,
  parseOfferWindow,
  recsFromSeasonality,
  recsFromWeeklyNarrative,
  seasonalityFromSettings,
  seasonalityWriteBlockedReason,
  summarizeWeeklyMetrics,
  windowContains,
} from "@tharros/ads-shared";
import { classifyMutation } from "@tharros/ads-shared/mutate";
import { filterOfflineRecommendations } from "../src/offline";

const FALL_NOW = new Date("2026-09-23T12:00:00.000Z");
const SUMMER_NOW = new Date("2026-07-15T12:00:00.000Z");
const JANUARY_NOW = new Date("2026-01-10T12:00:00.000Z");

function accountInput(extra: Record<string, unknown> = {}) {
  const pulled = mockPull("google", "Got Ductless");
  return {
    workspaceId: randomUUID(),
    clientId: randomUUID(),
    auditRunId: randomUUID(),
    adAccountId: randomUUID(),
    platform: "google" as const,
    entities: pulled.entities.map((entity) => ({
      entityType: entity.entityType,
      externalId: entity.externalId,
      name: entity.name,
      status: entity.status,
      parentExternalId: entity.parentExternalId,
      raw: entity.raw ?? {},
    })),
    metrics: pulled.metrics,
    ...extra,
  };
}

describe("M5.2 Phase F seasonality + owner weekly narrative", () => {
  it("defaults both Phase F flags hidden", () => {
    const flags = defaultCapabilityFlags();
    expect(flags["m52.seasonality_calendar"]).toBe("hidden");
    expect(flags["m52.owner_weekly_narrative"]).toBe("hidden");
    expect(seasonalityWriteBlockedReason(flags, "seasonality")).toBe("capability_m52_seasonality_calendar");
    expect(ownerWeeklyNarrativeWriteBlockedReason(flags, "weekly_narrative")).toBe(
      "capability_m52_owner_weekly_narrative",
    );
  });

  it("does not emit planning recs when both flags are off and keeps core recs", () => {
    const result = evaluateAccount(accountInput());
    expect(result.recommendations.some((row) => row.type === "seasonality")).toBe(false);
    expect(result.recommendations.some((row) => row.type === "weekly_narrative")).toBe(false);
    expect(result.recommendations.some((row) => row.type === "review_cpa")).toBe(true);
  });

  it("emits a fall shift rec from the default HVAC calendar", () => {
    const calendar = defaultSeasonalityCalendar();
    expect(windowContains(calendar.windows.find((row) => row.id === "hvac-fall-shift")!, FALL_NOW)).toBe(true);
    const { active } = classifyWindows(calendar.windows, FALL_NOW);
    expect(active.map((row) => row.id)).toContain("hvac-fall-shift");

    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          seasonalityEnabled: true,
          seasonalityWritable: true,
          seasonalityCalendar: calendar,
          seasonalityNow: FALL_NOW,
        },
      }),
    );
    const rec = result.recommendations.find((row) => row.type === "seasonality");
    expect(recommendationDraftSchema.safeParse(rec).success).toBe(true);
    expect(rec?.title).toMatch(/fall shift/i);
    expect(rec?.rationale).toMatch(/approve/i);
    expect(rec?.rationale).not.toMatch(/\bCTR\b|\bROAS\b/);
    expect(rec?.proposedMutationsJson.some((row) => row.action === "update_budget")).toBe(true);
    expect(rec?.proposedMutationsJson.every((row) => row.execute === false)).toBe(true);
    expect(rec?.evidenceJson.intent).toBe("shift");
    expect(rec?.evidenceJson.phase).toBe("active");
  });

  it("recommend_only seasonality never emits executable writes", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          seasonalityEnabled: true,
          seasonalityWritable: false,
          seasonalityCalendar: defaultSeasonalityCalendar(),
          seasonalityNow: FALL_NOW,
        },
      }),
    );
    const rec = result.recommendations.find((row) => row.type === "seasonality");
    expect(rec?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
  });

  it("summer ramp uses update_budget only when writable", () => {
    const drafts = recsFromSeasonality({
      platform: "google",
      entities: mockPull("google", "Got Ductless").entities,
      metrics: mockPull("google", "Got Ductless").metrics,
      calendar: defaultSeasonalityCalendar(),
      writable: true,
      now: SUMMER_NOW,
    });
    expect(drafts[0]?.evidence.intent).toBe("ramp");
    expect(drafts[0]?.mutations.some((row) => row.action === "update_budget")).toBe(true);

    const review = recsFromSeasonality({
      platform: "google",
      entities: mockPull("google", "Got Ductless").entities,
      metrics: mockPull("google", "Got Ductless").metrics,
      calendar: defaultSeasonalityCalendar(),
      writable: false,
      now: SUMMER_NOW,
    });
    expect(review[0]?.mutations.every((row) => row.action === "review")).toBe(true);
  });

  it("emits a metrics-grounded weekly narrative with no jargon", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          weeklyNarrativeEnabled: true,
          weeklyNarrativeWritable: false,
          weeklyNarrativeNow: FALL_NOW,
        },
      }),
    );
    const rec = result.recommendations.find((row) => row.type === "weekly_narrative");
    expect(recommendationDraftSchema.safeParse(rec).success).toBe(true);
    expect(rec?.evidenceJson.grounded).toBe(true);
    expect(rec?.evidenceJson.source).toBe("synced_metrics");
    expect(rec?.rationale).toMatch(/spent/i);
    expect(rec?.rationale).toMatch(/lead/i);
    expect(rec?.rationale).not.toMatch(/\bCTR\b|\bROAS\b|looking good|momentum|vibes/i);
    expect(rec?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
    expect(Array.isArray(rec?.evidenceJson.paragraphs)).toBe(true);
    expect(Number(rec?.evidenceJson.spend7dUsd)).toBeGreaterThan(0);
  });

  it("nested weekly action is pause or budget only when the flag is writable", () => {
    const pulled = mockPull("google", "Got Ductless");
    const wasteEntities = pulled.entities.map((entity) =>
      entity.entityType === "campaign" && entity.name.includes("furnace")
        ? entity
        : entity,
    );
    const wasteMetrics = pulled.metrics.map((row) =>
      row.entityExternalId.includes("camp-2") && row.window === "7d"
        ? { ...row, conversions: "0", spendUsd: "220.00" }
        : row,
    );
    const writable = recsFromWeeklyNarrative({
      platform: "google",
      entities: wasteEntities,
      metrics: wasteMetrics,
      writable: true,
      now: FALL_NOW,
    });
    expect(writable[0]?.mutations.some((row) => row.action === "pause" && row.payload.nestedAction === true)).toBe(true);

    const recommendOnly = recsFromWeeklyNarrative({
      platform: "google",
      entities: wasteEntities,
      metrics: wasteMetrics,
      writable: false,
      now: FALL_NOW,
    });
    expect(recommendOnly[0]?.mutations.every((row) => row.action === "review")).toBe(true);
  });

  it("weekly brief stays grounded when there is no synced spend", () => {
    const brief = buildWeeklyNarrative(
      summarizeWeeklyMetrics({
        entities: [],
        metrics: [],
        now: FALL_NOW,
      }),
    );
    expect(brief.grounded).toBe(true);
    expect(brief.paragraphs.join(" ")).toMatch(/no synced/i);
    expect(brief.paragraphs.join(" ")).not.toMatch(/looking good|great week|vibes/i);
  });

  it("hides planning recs when flags are hidden and keeps core recs", () => {
    const flags = defaultCapabilityFlags();
    const rows = [
      { type: "pause_waste" },
      { type: "seasonality" },
      { type: "weekly_narrative" },
      { type: "creative_fatigue" },
    ];
    expect(filterOfflineRecommendations(rows, flags).map((row) => row.type)).toEqual(["pause_waste"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.seasonality_calendar": "recommend_only" }).map(
        (row) => row.type,
      ),
    ).toEqual(["pause_waste", "seasonality"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.owner_weekly_narrative": "on" }).map((row) => row.type),
    ).toEqual(["pause_waste", "weekly_narrative"]);
  });

  it("blocks seasonality and narrative writes unless the matching flag is on", () => {
    const hidden = defaultCapabilityFlags();
    const recommendOnly = {
      ...hidden,
      "m52.seasonality_calendar": "recommend_only" as const,
      "m52.owner_weekly_narrative": "recommend_only" as const,
    };
    const on = {
      ...hidden,
      "m52.seasonality_calendar": "on" as const,
      "m52.owner_weekly_narrative": "on" as const,
    };
    expect(seasonalityWriteBlockedReason(recommendOnly, "seasonality")).toBe(
      "capability_m52_seasonality_calendar_recommend_only",
    );
    expect(seasonalityWriteBlockedReason(on, "seasonality")).toBeNull();
    expect(ownerWeeklyNarrativeWriteBlockedReason(recommendOnly, "weekly_narrative")).toBe(
      "capability_m52_owner_weekly_narrative_recommend_only",
    );
    expect(ownerWeeklyNarrativeWriteBlockedReason(on, "weekly_narrative")).toBeNull();
    expect(seasonalityWriteBlockedReason(recommendOnly, "pause_waste")).toBeNull();

    const seasonalityMutation = {
      platform: "google" as const,
      action: "update_budget" as const,
      target: { entityType: "campaign", externalId: "google-camp-1", name: "HVAC" },
      payload: { m52: "seasonality_calendar", reason: "seasonality_ramp", percent: 10 },
    };
    expect(classifyMutation(seasonalityMutation, recommendOnly)?.writes).toBe(false);
    expect(classifyMutation(seasonalityMutation, hidden)?.writes).toBe(false);
    expect(classifyMutation(seasonalityMutation, on)).toBeNull();

    const narrativeMutation = {
      platform: "google" as const,
      action: "pause" as const,
      target: { entityType: "campaign", externalId: "google-camp-2", name: "Furnace" },
      payload: { m52: "owner_weekly_narrative", nestedAction: true, reason: "weekly_narrative_pause_waste" },
    };
    expect(classifyMutation(narrativeMutation, recommendOnly)?.writes).toBe(false);
    expect(classifyMutation(narrativeMutation, on)).toBeNull();
  });

  it("parses operator calendar windows and ignores garbage without throwing", () => {
    expect(parseOfferWindow({ id: "x" })).toBeNull();
    expect(
      parseOfferWindow({
        id: "spring",
        name: "Spring tune-up",
        kind: "seasonal",
        startMonth: 3,
        startDay: 1,
        endMonth: 5,
        endDay: 31,
        intent: "ramp",
        campaignHint: "tune",
      })?.name,
    ).toBe("Spring tune-up");
    expect(() => seasonalityFromSettings({ planning: { seasonality: { windows: "nope" } } })).not.toThrow();
    expect(seasonalityFromSettings({}).source).toBe("default");
    expect(windowContains(defaultSeasonalityCalendar().windows[0]!, JANUARY_NOW)).toBe(true);
  });

  it("does not treat seasonality budget writes as M5.1 budget shift", () => {
    const mutation = {
      platform: "google" as const,
      action: "update_budget" as const,
      target: { entityType: "campaign", externalId: "google-camp-1" },
      payload: { m52: "seasonality_calendar", reason: "seasonality_shift_to", percent: 10 },
    };
    const hiddenM51 = defaultCapabilityFlags();
    expect(classifyMutation(mutation, { ...hiddenM51, "m52.seasonality_calendar": "on" })).toBeNull();
  });
});
