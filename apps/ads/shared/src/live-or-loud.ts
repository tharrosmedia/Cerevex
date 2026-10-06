import type { Platform, StoredOAuthTokens } from "./types";

/**
 * Shared no-mock-for-real-token rule (Meta M1, reused by later platform tests).
 * A mock token may use local test data. A real token never does.
 */

export const REAL_TOKEN_MOCK_REFUSED = "real_token_mock_refused";

export const SYNC_LIVE_OFF_SYNC_REASON = "sync.live is off. Existing rows were left in place.";

export const SYNC_LIVE_OFF_APPLY_REASON = "sync.live is off. Nothing was written.";

export function isMockToken(tokens: Pick<StoredOAuthTokens, "mock"> | null | undefined): boolean {
  return Boolean(tokens?.mock);
}

export function platformNotConfiguredCode(platform: Platform): string {
  return `${platform}.not_configured`;
}

/** Plain failure for an apply that must not pretend to succeed. */
export function platformNotConfiguredApplyReason(platform: Platform): string {
  const name = platform === "meta" ? "Meta" : "Google";
  return `${name} isn't set up on this server. Nothing was written.`;
}

export type RealTokenBlock =
  | { kind: "not_configured"; code: string; applyReason: string }
  | { kind: "sync_live_off"; syncReason: string; applyReason: string };

/**
 * Null means the caller may continue: mock tokens stay on the mock path,
 * and a configured process with sync.live on may call the platform.
 * Not-configured is reported before sync.live so a missing app secret fails loud.
 */
export function realTokenLiveBlock(input: {
  platform: Platform;
  mock?: boolean;
  configured: boolean;
  syncLive: boolean;
}): RealTokenBlock | null {
  if (input.mock) return null;
  if (!input.configured) {
    return {
      kind: "not_configured",
      code: platformNotConfiguredCode(input.platform),
      applyReason: platformNotConfiguredApplyReason(input.platform),
    };
  }
  if (!input.syncLive) {
    return {
      kind: "sync_live_off",
      syncReason: SYNC_LIVE_OFF_SYNC_REASON,
      applyReason: SYNC_LIVE_OFF_APPLY_REASON,
    };
  }
  return null;
}

/** A real token with live calls disallowed must not receive mock rows. */
export function refuseMockPull(tokens: Pick<StoredOAuthTokens, "mock"> | null | undefined, allowLive: boolean): void {
  if (isMockToken(tokens) || allowLive) return;
  throw new Error(REAL_TOKEN_MOCK_REFUSED);
}
