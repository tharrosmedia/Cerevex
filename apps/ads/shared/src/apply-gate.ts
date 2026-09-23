/**
 * Authorize-to-apply gate.
 *
 * Apply requires a valid authorization, workspace kill switch OFF,
 * and the target ad account not frozen. Deny/Snooze never reach this gate.
 */

export const APPLY_BLOCK_REASONS = [
  "workspace_not_found",
  "apply_kill_switch",
  "account_frozen",
  "authorization_required",
  "authorization_revoked",
  "authorization_expired",
] as const;

export type ApplyBlockReason = (typeof APPLY_BLOCK_REASONS)[number];

export type ApplyGateInput = {
  expectedWorkspaceId: string;
  workspace: { applyKillSwitch: boolean } | null | undefined;
  authorization:
    | {
        workspaceId: string;
        revokedAt: Date | string | null;
        expiresAt: Date | string | null;
      }
    | null
    | undefined;
  account?: { frozen: boolean } | null;
  now?: Date;
};

export type ApplyGateResult =
  | { allowed: true; blocked: null; writes: true }
  | { allowed: false; blocked: ApplyBlockReason; writes: false };

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function evaluateApplyGate(input: ApplyGateInput): ApplyGateResult {
  const now = input.now ?? new Date();
  if (!input.workspace) {
    return { allowed: false, blocked: "workspace_not_found", writes: false };
  }
  if (input.workspace.applyKillSwitch) {
    return { allowed: false, blocked: "apply_kill_switch", writes: false };
  }
  if (input.account?.frozen) {
    return { allowed: false, blocked: "account_frozen", writes: false };
  }
  if (!input.authorization || input.authorization.workspaceId !== input.expectedWorkspaceId) {
    return { allowed: false, blocked: "authorization_required", writes: false };
  }
  if (asTime(input.authorization.revokedAt)) {
    return { allowed: false, blocked: "authorization_revoked", writes: false };
  }
  const expires = asTime(input.authorization.expiresAt);
  if (expires !== null && expires <= now.getTime()) {
    return { allowed: false, blocked: "authorization_expired", writes: false };
  }
  return { allowed: true, blocked: null, writes: true };
}

export function applyBlockMessage(reason: ApplyBlockReason | null | undefined): string {
  switch (reason) {
    case "apply_kill_switch":
      return "Approve is blocked while ads are paused on this workspace.";
    case "account_frozen":
      return "Approve is blocked because this ad account is frozen.";
    case "authorization_required":
      return "Approve this recommendation first. Nothing was written.";
    case "authorization_revoked":
      return "This approval was revoked. Nothing was written.";
    case "authorization_expired":
      return "This approval expired. Approve again to apply.";
    case "workspace_not_found":
      return "Workspace not found.";
    default:
      return "Apply is blocked.";
  }
}
