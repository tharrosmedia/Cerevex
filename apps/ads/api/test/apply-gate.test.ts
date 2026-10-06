import { describe, expect, it } from "vitest";
import { defaultCapabilityFlags } from "@tharros/ads-shared";
import { applyBlockMessage, evaluateApplyGate } from "@tharros/ads-shared/apply-gate";

const workspaceId = "11111111-1111-1111-1111-111111111111";

describe("authorize-to-apply gate", () => {
  it("blocks when kill switch is on (default)", () => {
    const gate = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: true },
      authorization: {
        workspaceId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(gate).toEqual({ allowed: false, blocked: "apply_kill_switch", writes: false });
  });

  it("blocks without an authorization even if kill switch is off", () => {
    const gate = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: false },
      authorization: null,
    });
    expect(gate.blocked).toBe("authorization_required");
    expect(gate.allowed).toBe(false);
    expect(gate.writes).toBe(false);
  });

  it("blocks revoked and expired grants", () => {
    expect(
      evaluateApplyGate({
        expectedWorkspaceId: workspaceId,
        workspace: { applyKillSwitch: false },
        authorization: { workspaceId, revokedAt: new Date(), expiresAt: null },
      }).blocked,
    ).toBe("authorization_revoked");

    expect(
      evaluateApplyGate({
        expectedWorkspaceId: workspaceId,
        workspace: { applyKillSwitch: false },
        authorization: {
          workspaceId,
          revokedAt: null,
          expiresAt: new Date(Date.now() - 1000),
        },
      }).blocked,
    ).toBe("authorization_expired");
  });

  it("blocks a frozen ad account", () => {
    const gate = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: false },
      authorization: {
        workspaceId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      account: { frozen: true },
    });
    expect(gate).toEqual({ allowed: false, blocked: "account_frozen", writes: false });
  });

  it("refuses ads apply for store and client scopes before the kill switch", () => {
    for (const recommendationScope of ["store", "client"]) {
      const gate = evaluateApplyGate({
        expectedWorkspaceId: workspaceId,
        workspace: { applyKillSwitch: true },
        authorization: {
          workspaceId,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
        recommendationScope,
      });
      expect(gate).toEqual({ allowed: false, blocked: "not_ad_account_scoped", writes: false });
    }
  });

  it("still blocks an ad-account recommendation when the kill switch is on", () => {
    const gate = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: true },
      authorization: {
        workspaceId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      recommendationScope: "ad_account",
    });
    expect(gate.blocked).toBe("apply_kill_switch");
  });

  it("blocks a Meta live write when apply.meta is hidden or recommend-only", () => {
    const authorization = {
      workspaceId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const hidden = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: false },
      authorization,
      account: { frozen: false },
      platform: "meta",
      capabilities: defaultCapabilityFlags(),
      mock: false,
    });
    expect(hidden).toEqual({ allowed: false, blocked: "apply_meta_hidden", writes: false });
    expect(applyBlockMessage(hidden.blocked)).toBe(
      "Meta live writes are off. The decision is saved. Nothing was written.",
    );

    const recommend = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: false },
      authorization,
      account: { frozen: false },
      platform: "meta",
      capabilities: { ...defaultCapabilityFlags(), "apply.meta": "recommend_only" },
      mock: false,
    });
    expect(recommend).toEqual({ allowed: false, blocked: "apply_meta_recommend_only", writes: false });
    expect(applyBlockMessage(recommend.blocked)).toBe(
      "Meta live writes are recommend-only. The decision is saved. Nothing was written.",
    );
  });

  it("allows a Meta live write only when apply.meta is on, and still blocks the kill switch", () => {
    const authorization = {
      workspaceId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const on = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: false },
      authorization,
      account: { frozen: false },
      platform: "meta",
      capabilities: { ...defaultCapabilityFlags(), "apply.meta": "on" },
      mock: false,
    });
    expect(on).toEqual({ allowed: true, blocked: null, writes: true });

    const killed = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: true },
      authorization,
      account: { frozen: false },
      platform: "meta",
      capabilities: { ...defaultCapabilityFlags(), "apply.meta": "on" },
      mock: false,
    });
    expect(killed).toEqual({ allowed: false, blocked: "apply_kill_switch", writes: false });
  });

  it("does not apply the Meta flag to mock tokens or Google", () => {
    const authorization = {
      workspaceId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    expect(
      evaluateApplyGate({
        expectedWorkspaceId: workspaceId,
        workspace: { applyKillSwitch: false },
        authorization,
        platform: "meta",
        capabilities: defaultCapabilityFlags(),
        mock: true,
      }),
    ).toEqual({ allowed: true, blocked: null, writes: true });
    expect(
      evaluateApplyGate({
        expectedWorkspaceId: workspaceId,
        workspace: { applyKillSwitch: false },
        authorization,
        platform: "google",
        capabilities: defaultCapabilityFlags(),
        mock: false,
      }),
    ).toEqual({ allowed: true, blocked: null, writes: true });
  });

  it("allows apply when every gate passes", () => {
    const gate = evaluateApplyGate({
      expectedWorkspaceId: workspaceId,
      workspace: { applyKillSwitch: false },
      authorization: {
        workspaceId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      account: { frozen: false },
    });
    expect(gate).toEqual({ allowed: true, blocked: null, writes: true });
  });
});
