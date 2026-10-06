import type { CapabilityFlags } from "@cerevex/contracts";

/**
 * Authorize-to-apply gate.
 *
 * Apply requires a valid authorization, workspace kill switch OFF,
 * and the target ad account not frozen. Deny/Snooze never reach this gate.
 * A Meta live write also needs apply.meta on. Mock tokens are not live writes.
 */

export const NOT_AD_ACCOUNT_SCOPED = "not_ad_account_scoped" as const;

export const APPLY_BLOCK_REASONS = [
  "not_ad_account_scoped",
  "workspace_not_found",
  "apply_kill_switch",
  "account_frozen",
  "authorization_required",
  "authorization_revoked",
  "authorization_expired",
  "apply_meta_hidden",
  "apply_meta_recommend_only",
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
  /** When set and not ad_account, ads apply is refused before the kill switch. */
  recommendationScope?: string | null;
  /** Ad account platform. Meta live writes also need apply.meta on. */
  platform?: string | null;
  capabilities?: CapabilityFlags | null;
  /** True only for a mock token. Omitted or false is a live Meta write when platform is meta. */
  mock?: boolean;
  now?: Date;
};

/** Hidden and recommend_only record the decision elsewhere and write nothing. */
export function metaLiveWriteBlock(input: {
  platform?: string | null;
  mock?: boolean;
  capabilities?: CapabilityFlags | null;
}): "apply_meta_hidden" | "apply_meta_recommend_only" | null {
  if (input.platform !== "meta" || input.mock === true) return null;
  const state = input.capabilities?.["apply.meta"];
  if (state === "on") return null;
  if (state === "recommend_only") return "apply_meta_recommend_only";
  return "apply_meta_hidden";
}

export class NotAdAccountScopedError extends Error {
  readonly reason = NOT_AD_ACCOUNT_SCOPED;

  constructor() {
    super(NOT_AD_ACCOUNT_SCOPED);
    this.name = "NotAdAccountScopedError";
  }
}

/** Ads platform mutations are only queued for ad_account recommendations. */
export function adsPlatformMutationRefusal(
  scope: string | null | undefined,
): typeof NOT_AD_ACCOUNT_SCOPED | null {
  if (scope == null || scope === "ad_account") return null;
  return NOT_AD_ACCOUNT_SCOPED;
}

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
  if (adsPlatformMutationRefusal(input.recommendationScope)) {
    return { allowed: false, blocked: NOT_AD_ACCOUNT_SCOPED, writes: false };
  }
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
  const metaBlock = metaLiveWriteBlock({
    platform: input.platform,
    mock: input.mock,
    capabilities: input.capabilities,
  });
  if (metaBlock) return { allowed: false, blocked: metaBlock, writes: false };
  return { allowed: true, blocked: null, writes: true };
}

export function applyBlockMessage(reason: ApplyBlockReason | null | undefined): string {
  switch (reason) {
    case "not_ad_account_scoped":
      return "This recommendation is not an ad-account change. The decision is saved. Nothing was queued for Meta or Google.";
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
    case "apply_meta_hidden":
      return "Meta live writes are off. The decision is saved. Nothing was written.";
    case "apply_meta_recommend_only":
      return "Meta live writes are recommend-only. The decision is saved. Nothing was written.";
    default:
      return "Apply is blocked.";
  }
}

export {
  META_COULD_NOT_CONFIRM,
  META_CURRENCY_REASON,
  META_TARGET_ID_REASON,
  META_TARGET_NOT_IN_ACCOUNT,
  META_TARGET_NOT_IN_ACCOUNT_REASON,
  META_TWO_DECIMAL_CURRENCIES,
  isMetaTwoDecimalCurrency,
  metaCurrencyRefusal,
} from "./meta-write-safety";
