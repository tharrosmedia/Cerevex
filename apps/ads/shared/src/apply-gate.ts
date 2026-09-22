/**
 * Authorize-to-apply gate.
 *
 * Apply is never unsupervised. Even when the kill switch is off and an
 * authorization exists, M3 does not implement Meta/Google writes.
 */

export const APPLY_BLOCK_REASONS = [
  "workspace_not_found",
  "apply_kill_switch",
  "authorization_required",
  "authorization_revoked",
  "authorization_expired",
  "apply_not_implemented",
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
  now?: Date;
};

export type ApplyGateResult = {
  allowed: false;
  blocked: ApplyBlockReason;
  writes: false;
};

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
  return { allowed: false, blocked: "apply_not_implemented", writes: false };
}
