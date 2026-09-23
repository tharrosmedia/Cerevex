import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAccount } from "@tharros/ads-shared/audit-engine";
import { recommendationDraftSchema } from "@tharros/ads-shared/audit-schemas";
import {
  brandGuardrailSpendBlockedReason,
  brandGuardrailsWriteBlockedReason,
  defaultCapabilityFlags,
  mockPull,
  recsFromBrandGuardrails,
  recsFromCreativeFatigue,
  recsFromGeoDiscipline,
  recsFromSearchNegatives,
  scanClaimHits,
  searchNegativesWriteBlockedReason,
} from "@tharros/ads-shared";
import { classifyMutation } from "@tharros/ads-shared/mutate";
import { filterOfflineRecommendations } from "../src/offline";

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

describe("M5.2 Phase E operator hygiene", () => {
  it("does not emit hygiene recs when all Phase E flags are off", () => {
    const result = evaluateAccount(accountInput());
    expect(result.recommendations.some((row) => row.type === "creative_fatigue")).toBe(false);
    expect(result.recommendations.some((row) => row.type === "search_negatives")).toBe(false);
    expect(result.recommendations.some((row) => row.type === "geo_discipline")).toBe(false);
    expect(result.recommendations.some((row) => row.type === "brand_guardrails")).toBe(false);
    expect(result.recommendations.some((row) => row.type === "review_cpa")).toBe(true);
  });

  it("emits four hygiene recs from mock Google pull when flags are on", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          creativeFatigueEnabled: true,
          searchNegativesEnabled: true,
          searchNegativesWritable: true,
          geoDisciplineEnabled: true,
          geoDisciplineWritable: true,
          brandGuardrailsEnabled: true,
          brandGuardrailsWritable: true,
        },
      }),
    );
    const types = result.recommendations.map((row) => row.type);
    expect(types).toContain("creative_fatigue");
    expect(types).toContain("search_negatives");
    expect(types).toContain("geo_discipline");
    expect(types).toContain("brand_guardrails");

    const fatigue = result.recommendations.find((row) => row.type === "creative_fatigue");
    expect(recommendationDraftSchema.safeParse(fatigue).success).toBe(true);
    expect(fatigue?.rationale).toMatch(/approve/i);
    expect(fatigue?.rationale).not.toMatch(/\bCTR\b|\bROAS\b/);
    expect(fatigue?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
    expect(fatigue?.evidenceJson.cadenceDays).toBeDefined();

    const negatives = result.recommendations.find((row) => row.type === "search_negatives");
    expect(negatives?.proposedMutationsJson.some((row) => row.action === "add_negative")).toBe(true);
    expect(negatives?.proposedMutationsJson.every((row) => row.execute === false)).toBe(true);

    const geo = result.recommendations.find((row) => row.type === "geo_discipline");
    expect(geo?.proposedMutationsJson.some((row) => row.action === "tighten_geo")).toBe(true);

    const brand = result.recommendations.find((row) => row.type === "brand_guardrails");
    expect(brand?.evidenceJson.guardrail).toBe("block");
    expect(brand?.proposedMutationsJson.some((row) => row.action === "pause")).toBe(true);
    expect(brand?.rationale.toLowerCase()).toMatch(/block/);
  });

  it("recommend_only search, geo, and brand never emit executable writes", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          creativeFatigueEnabled: true,
          searchNegativesEnabled: true,
          searchNegativesWritable: false,
          geoDisciplineEnabled: true,
          geoDisciplineWritable: false,
          brandGuardrailsEnabled: true,
          brandGuardrailsWritable: false,
        },
      }),
    );
    const negatives = result.recommendations.find((row) => row.type === "search_negatives");
    expect(negatives?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
    const geo = result.recommendations.find((row) => row.type === "geo_discipline");
    expect(geo?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
    const brand = result.recommendations.find((row) => row.type === "brand_guardrails");
    expect(brand?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
  });

  it("hides hygiene recs when flags are hidden and keeps core recs", () => {
    const flags = defaultCapabilityFlags();
    const rows = [
      { type: "pause_waste" },
      { type: "creative_fatigue" },
      { type: "search_negatives" },
      { type: "geo_discipline" },
      { type: "brand_guardrails" },
      { type: "lp_intelligence" },
    ];
    expect(filterOfflineRecommendations(rows, flags).map((row) => row.type)).toEqual(["pause_waste"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.creative_fatigue": "recommend_only" }).map((row) => row.type),
    ).toEqual(["pause_waste", "creative_fatigue"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.search_negatives": "on" }).map((row) => row.type),
    ).toEqual(["pause_waste", "search_negatives"]);
    expect(
      filterOfflineRecommendations(rows, {
        ...flags,
        "m52.geo_discipline": "on",
        "m52.brand_guardrails": "recommend_only",
      }).map((row) => row.type),
    ).toEqual(["pause_waste", "geo_discipline", "brand_guardrails"]);
  });

  it("skips search-negative and geo writes unless the matching flag is on", () => {
    const hidden = defaultCapabilityFlags();
    const recommendOnly = {
      ...hidden,
      "m52.search_negatives": "recommend_only" as const,
      "m52.geo_discipline": "recommend_only" as const,
    };
    const on = {
      ...hidden,
      "m52.search_negatives": "on" as const,
      "m52.geo_discipline": "on" as const,
    };
    const negative = {
      platform: "google" as const,
      action: "add_negative" as const,
      target: { entityType: "campaign", externalId: "camp-1", name: "HVAC" },
      payload: { text: "free ductless estimate", m52: "search_negatives", reason: "search_term_waste" },
    };
    const geo = {
      platform: "google" as const,
      action: "tighten_geo" as const,
      target: { entityType: "campaign", externalId: "camp-1", name: "HVAC" },
      payload: { m52: "geo_discipline", serviceArea: ["local"] },
    };
    expect(classifyMutation(negative, recommendOnly)?.writes).toBe(false);
    expect(classifyMutation(geo, recommendOnly)?.writes).toBe(false);
    expect(classifyMutation(negative, on)).toBeNull();
    expect(classifyMutation(geo, on)).toBeNull();
    expect(searchNegativesWriteBlockedReason(recommendOnly, "search_negatives")).toBe(
      "capability_m52_search_negatives_recommend_only",
    );
  });

  it("blocks spend-up past a blocking claim when brand guardrails are visible", () => {
    const hits = scanClaimHits("Guaranteed lowest price install");
    expect(hits.some((hit) => hit.level === "block")).toBe(true);
    expect(
      brandGuardrailSpendBlockedReason(
        true,
        { action: "update_budget", payload: { percent: 10, direction: "up" } },
        hits,
      ),
    ).toBe("brand_guardrail_block");
    expect(
      brandGuardrailSpendBlockedReason(
        false,
        { action: "update_budget", payload: { percent: 10, direction: "up" } },
        hits,
      ),
    ).toBeNull();
    expect(
      brandGuardrailSpendBlockedReason(true, { action: "update_budget", payload: { percent: -10 } }, hits),
    ).toBeNull();
    expect(brandGuardrailsWriteBlockedReason(defaultCapabilityFlags(), "brand_guardrails")).toBe(
      "capability_m52_brand_guardrails",
    );
  });

  it("builds drafts with a plain-language why and metrics for Details", () => {
    const pulled = mockPull("google", "Elmar HVAC");
    const entities = pulled.entities.map((entity) => ({
      entityType: entity.entityType,
      externalId: entity.externalId,
      name: entity.name,
      status: entity.status,
      parentExternalId: entity.parentExternalId,
      raw: entity.raw ?? {},
    }));
    const fatigue = recsFromCreativeFatigue({ entities, metrics: pulled.metrics, writable: false });
    expect(fatigue[0]?.why.length).toBeGreaterThan(20);
    expect(fatigue[0]?.evidence.impressions30d).toBeGreaterThan(0);
    const negatives = recsFromSearchNegatives({ platform: "google", entities, writable: true });
    expect(negatives[0]?.mutations.some((row) => row.action === "add_negative")).toBe(true);
    expect(recsFromSearchNegatives({ platform: "meta", entities, writable: true })).toEqual([]);
    const geo = recsFromGeoDiscipline({ entities, writable: true });
    expect(geo[0]?.mutations[0]?.action).toBe("tighten_geo");
    const brand = recsFromBrandGuardrails({ entities, writable: true });
    expect(brand[0]?.evidence.guardrail).toBe("block");
    expect(JSON.stringify(brand[0])).not.toMatch(/unsupervised spend silently/i);
  });
});
