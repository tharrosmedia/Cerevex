import { describe, expect, it } from "vitest";
import { classifyMutation } from "@tharros/ads-shared/mutate";
import {
  inferApplyJobType,
  isCreateNewMutationAction,
  resolveWorkspaceCapabilities,
  summarizeMutation,
} from "@tharros/ads-shared";

describe("M5 mutation classes", () => {
  it("skips create-new and review classes", () => {
    expect(isCreateNewMutationAction("create_ad")).toBe(true);
    expect(isCreateNewMutationAction("pause")).toBe(false);
    const skipped = classifyMutation({
      platform: "meta",
      action: "create_ad",
      target: { entityType: "campaign", externalId: "1", name: "HVAC" },
      payload: {},
    });
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.writes).toBe(false);
    expect(skipped?.reason).toMatch(/apply\.create_entity|Create-entity/i);
  });

  it("summarizes bid and budget changes in plain language", () => {
    expect(
      summarizeMutation({
        action: "update_bid",
        platform: "meta",
        target: { name: "HVAC leads" },
        payload: { percent: -15 },
      }),
    ).toContain("15%");
    expect(
      summarizeMutation({
        action: "pause",
        platform: "google",
        target: { name: "Waste campaign" },
      }),
    ).toMatch(/Pause/);
  });

  it("skips bid/budget when the capability registry rolls them back", () => {
    const flags = resolveWorkspaceCapabilities({
      capabilities: { "apply.bid": "hidden", "apply.budget": "hidden" },
    });
    expect(
      classifyMutation(
        {
          platform: "meta",
          action: "update_bid",
          target: { entityType: "adset", externalId: "1", name: "HVAC" },
          payload: { percent: -10 },
        },
        flags,
      )?.reason,
    ).toMatch(/apply\.bid|FEATURE_BID_MUTATIONS/);
    expect(
      classifyMutation(
        {
          platform: "meta",
          action: "update_budget",
          target: { entityType: "campaign", externalId: "1", name: "HVAC" },
          payload: { percent: -10 },
        },
        flags,
      )?.reason,
    ).toMatch(/apply\.budget|FEATURE_BUDGET_MUTATIONS/);
    expect(inferApplyJobType([{ action: "create_ad" }])).toBe("create_entity");
  });
});
