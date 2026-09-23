import { describe, expect, it } from "vitest";
import { evaluateApplyGate } from "@tharros/ads-shared/apply-gate";

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
