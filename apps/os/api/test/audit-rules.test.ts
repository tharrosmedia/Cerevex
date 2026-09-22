import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAccount, AUDIT_THRESHOLDS } from "@tharros/shared/audit-engine";
import {
  findingDraftSchema,
  proposedMutationSchema,
  recommendationDraftSchema,
} from "@tharros/shared/audit-schemas";
import { mockPull } from "@tharros/shared";

describe("M3 audit rules (no database)", () => {
  const scope = {
    workspaceId: randomUUID(),
    clientId: randomUUID(),
    auditRunId: randomUUID(),
    adAccountId: randomUUID(),
  };

  it("emits schema-valid findings and proposed-only recs from mock Meta pull", () => {
    const pulled = mockPull("meta", "Got Ductless");
    const result = evaluateAccount({
      ...scope,
      platform: "meta",
      entities: pulled.entities,
      metrics: pulled.metrics,
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.findings.some((row) => row.bodyJson.ruleId === "high_cpa")).toBe(true);
    expect(result.findings.some((row) => row.bodyJson.ruleId === "low_ctr")).toBe(true);
    expect(result.recommendations.some((row) => row.type === "review_cpa")).toBe(true);

    for (const finding of result.findings) {
      expect(findingDraftSchema.safeParse(finding).success).toBe(true);
      expect(finding.bodyJson.writes).toBe(false);
    }
    for (const rec of result.recommendations) {
      expect(recommendationDraftSchema.safeParse(rec).success).toBe(true);
      expect(rec.status).toBe("proposed");
      expect(rec.schemaVersion).toBe("1");
      for (const mutation of rec.proposedMutationsJson) {
        expect(proposedMutationSchema.safeParse(mutation).success).toBe(true);
        expect(mutation.execute).toBe(false);
      }
    }
  });

  it("emits keyword expansion for mock Google pull and never sets execute true", () => {
    const pulled = mockPull("google", "KC Prestige");
    const result = evaluateAccount({
      ...scope,
      platform: "google",
      entities: pulled.entities,
      metrics: pulled.metrics,
    });
    expect(result.recommendations.some((row) => row.type === "expand_keywords")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("\"execute\":true");
    expect(pulled.metrics[0]?.spendUsd).toBeDefined();
    expect(AUDIT_THRESHOLDS.cpaHighUsd).toBe(40);
  });

  it("returns snapshot + no_entities without recommendations when tables are empty", () => {
    const result = evaluateAccount({
      ...scope,
      platform: "meta",
      entities: [],
      metrics: [],
    });
    expect(result.recommendations).toEqual([]);
    expect(result.findings.some((row) => row.bodyJson.ruleId === "no_entities")).toBe(true);
  });

  it("rejects a recommendation that tries to execute a mutation", () => {
    const pulled = mockPull("meta", "Elmar HVAC");
    const result = evaluateAccount({
      ...scope,
      platform: "meta",
      entities: pulled.entities,
      metrics: pulled.metrics,
    });
    const rec = result.recommendations[0];
    expect(rec).toBeTruthy();
    const parsed = recommendationDraftSchema.safeParse({
      ...rec,
      proposedMutationsJson: rec!.proposedMutationsJson.map((mutation) => ({
        ...mutation,
        execute: true,
      })),
    });
    expect(parsed.success).toBe(false);
  });
});
