import { describe, expect, it } from "vitest";
import { classifyMutation } from "@tharros/ads-shared/mutate";
import { isCreateNewMutationAction, summarizeMutation } from "@tharros/ads-shared";

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
    expect(skipped?.reason).toMatch(/Create-new/i);
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
});
