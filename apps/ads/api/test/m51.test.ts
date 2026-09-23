import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateClientM51, M51_THRESHOLDS } from "@tharros/ads-shared/m51-engine";
import { analyzeCopySentiment, compareAdsInGroup, creativeFromRaw } from "@tharros/ads-shared/creative-analysis";
import { compareAdToLanding } from "@tharros/ads-shared/lp-congruence";
import { inferPlatformFromClick, summarizeFunnel } from "@tharros/ads-shared/funnel";
import { classifyMutation, isM51BudgetShiftMutation } from "@tharros/ads-shared/mutate";
import {
  budgetShiftWriteBlockedReason,
  defaultCapabilityFlags,
  mockPull,
  proposedMutationSchema,
} from "@tharros/ads-shared";

function flagsOn() {
  return {
    ...defaultCapabilityFlags(),
    "m51.budget_shift": "on" as const,
    "m51.grok_creatives": "on" as const,
    "m51.lp_congruence": "on" as const,
    "m51.ga4_connect": "on" as const,
    "m51.brainstorm": "on" as const,
    "apply.create_entity": "on" as const,
  };
}

function slice(platform: "meta" | "google", clientName: string, adAccountId: string) {
  const pulled = mockPull(platform, clientName);
  return {
    adAccountId,
    platform,
    entities: pulled.entities.map((entity) => ({
      entityType: entity.entityType,
      externalId: entity.externalId,
      name: entity.name,
      status: entity.status,
      parentExternalId: entity.parentExternalId,
      raw: entity.raw ?? {},
    })),
    metrics: pulled.metrics,
  };
}

describe("M5.1 engines (no database)", () => {
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const auditRunId = randomUUID();

  it("emits budget shift recs with execute:false budget mutations from mock metrics", () => {
    const result = evaluateClientM51({
      workspaceId,
      clientId,
      auditRunId,
      capabilities: flagsOn(),
      accounts: [slice("meta", "Got Ductless", randomUUID())],
    });
    const recs = result.recommendations.filter((row) => row.type === "budget_shift");
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]?.rationale).toMatch(/Approve/i);
    expect(recs[0]?.rationale).not.toMatch(/ROAS|CTR/i);
    for (const rec of recs) {
      expect(rec.status).toBe("proposed");
      expect(rec.proposedMutationsJson.some((row) => row.action === "update_budget")).toBe(true);
      for (const mutation of rec.proposedMutationsJson) {
        expect(proposedMutationSchema.safeParse(mutation).success).toBe(true);
        expect(mutation.execute).toBe(false);
      }
    }
    expect(M51_THRESHOLDS.shiftPercent).toBe(15);
  });

  it("recommend_only budget shift never emits update_budget or an apply write", () => {
    const recommendOnly = {
      ...defaultCapabilityFlags(),
      "m51.budget_shift": "recommend_only" as const,
      "apply.budget": "on" as const,
    };
    const result = evaluateClientM51({
      workspaceId,
      clientId,
      auditRunId,
      capabilities: recommendOnly,
      accounts: [
        slice("meta", "Got Ductless", randomUUID()),
        slice("google", "Got Ductless", randomUUID()),
      ],
    });
    const recs = result.recommendations.filter((row) => row.type === "budget_shift");
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.proposedMutationsJson.some((row) => row.action === "update_budget")).toBe(false);
      expect(rec.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
      expect(rec.rationale).toMatch(/recommend-only|will not change spend/i);
      for (const mutation of rec.proposedMutationsJson) {
        expect(mutation.execute).toBe(false);
        expect(mutation.payload.m51).toBe("budget_shift");
        expect(mutation.payload.action).toBe("do_not_autoshift_budget");
        const classified = classifyMutation(mutation, recommendOnly);
        expect(classified?.writes).toBe(false);
        expect(classified?.status).toBe("skipped");
      }
    }

    const shiftWrite = {
      platform: "meta" as const,
      action: "update_budget" as const,
      target: { entityType: "campaign", externalId: "1", name: "HVAC" },
      payload: { percent: -15, reason: "shift_from_weaker", m51: "budget_shift" },
    };
    expect(isM51BudgetShiftMutation(shiftWrite)).toBe(true);
    const blocked = classifyMutation(shiftWrite, recommendOnly);
    expect(blocked?.writes).toBe(false);
    expect(blocked?.status).toBe("skipped");
    expect(blocked?.reason).toMatch(/recommend-only|m51\.budget_shift/);

    expect(budgetShiftWriteBlockedReason(recommendOnly, "budget_shift")).toBe(
      "capability_m51_budget_shift_recommend_only",
    );
    expect(budgetShiftWriteBlockedReason(flagsOn(), "budget_shift")).toBeNull();
    expect(budgetShiftWriteBlockedReason(recommendOnly, "creative_test")).toBeNull();

    const genericBudget = {
      platform: "meta" as const,
      action: "update_budget" as const,
      target: { entityType: "campaign", externalId: "1", name: "HVAC" },
      payload: { percent: -10 },
    };
    expect(isM51BudgetShiftMutation(genericBudget)).toBe(false);
    expect(classifyMutation(genericBudget, recommendOnly)).toBeNull();
  });

  it("emits a cross-platform creative test and does not invent metrics", () => {
    const result = evaluateClientM51({
      workspaceId,
      clientId,
      auditRunId,
      capabilities: flagsOn(),
      accounts: [
        slice("meta", "KC Prestige", randomUUID()),
        slice("google", "KC Prestige", randomUUID()),
      ],
    });
    expect(result.recommendations.some((row) => row.type === "creative_test")).toBe(true);
    expect(result.recommendations.some((row) => row.type === "budget_shift")).toBe(true);
    expect(result.recommendations.some((row) => row.type === "lp_congruence")).toBe(true);
    const hidden = evaluateClientM51({
      workspaceId,
      clientId,
      auditRunId,
      capabilities: defaultCapabilityFlags(),
      accounts: [slice("meta", "Elmar HVAC", randomUUID()), slice("google", "Elmar HVAC", randomUUID())],
    });
    expect(hidden.recommendations).toEqual([]);
  });

  it("strengthens a budget rec when funnel data exists", () => {
    const funnel = summarizeFunnel(
      [
        { name: "page_view", source: "first_party", platform: "meta", campaign: "Got Ductless — Meta HVAC leads" },
        { name: "page_view", source: "first_party", platform: "meta", campaign: "Got Ductless — Meta HVAC leads" },
        { name: "page_view", source: "first_party", platform: "meta", campaign: "Got Ductless — Meta HVAC leads" },
        { name: "generate_lead", source: "first_party", platform: "meta", campaign: "Got Ductless — Meta HVAC leads" },
      ],
      false,
    );
    expect(funnel.best).toBeTruthy();
    const result = evaluateClientM51({
      workspaceId,
      clientId,
      auditRunId,
      capabilities: flagsOn(),
      accounts: [slice("meta", "Got Ductless", randomUUID())],
      funnel,
    });
    const rec = result.recommendations.find((row) => row.type === "budget_shift");
    expect(rec?.rationale).toMatch(/pixel|lead/i);
    expect(Number(rec?.confidence ?? 0)).toBeGreaterThan(0.7);
  });

  it("scores copy and landing-page mismatch without inventing spend", () => {
    const creative = creativeFromRaw({
      headline: "Same-week ductless install",
      body: "Factory-trained techs. Tune-up from $89.",
      offer: "Tune-up from $89",
    });
    expect(analyzeCopySentiment(creative).label).toBe("warm");
    const mismatch = compareAdToLanding(creative, {
      url: "https://example.com/furnace",
      headline: "Get 20% off a new furnace",
      bodyText: "Replace your furnace this month.",
      offerText: "20% off a new furnace",
    });
    expect(mismatch.matched).toBe(false);
    expect(mismatch.siteApply).toBe("later");
    expect(mismatch.recommendedFixes.length).toBeGreaterThan(0);
    const lift = compareAdsInGroup([
      { externalId: "a", name: "Winner", platform: "meta", impressions: 2000, clicks: 80, conversions: 8, spendUsd: 200 },
      { externalId: "b", name: "Loser", platform: "meta", impressions: 2000, clicks: 20, conversions: 2, spendUsd: 200 },
    ]);
    expect(lift?.why).toMatch(/clicks/);
    expect(inferPlatformFromClick({ gclid: "x" })).toBe("google");
    expect(inferPlatformFromClick({ fbclid: "y" })).toBe("meta");
  });

  it("allows create_ad only when apply.create_entity is on", () => {
    const mutation = {
      platform: "meta" as const,
      action: "create_ad" as const,
      target: { entityType: "campaign", externalId: "1", name: "HVAC" },
      payload: {},
    };
    expect(classifyMutation(mutation)?.status).toBe("skipped");
    expect(classifyMutation(mutation, flagsOn())).toBeNull();
  });
});
