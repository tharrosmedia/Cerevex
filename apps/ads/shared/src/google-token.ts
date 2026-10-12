import { eq } from "drizzle-orm";
import type { ApplyMutation } from "./audit-schemas";
import { writeAuditEvent } from "./audit";
import { getDb } from "./db";
import type { MutationOutcome } from "./mutate-types";
import { adAccounts } from "./schema";

/** Stored on the account. The card shows Needs reconnect. */
export const GOOGLE_REFRESH_REJECTED = "google.refresh_rejected";

/** Campaigns synced. A later search failed, so this is not a plain success. */
export const GOOGLE_PARTIAL_PULL = "google.partial_pull";

/** Throttle. Retry later. Not Needs reconnect. */
export const GOOGLE_RATE_LIMITED = "google.rate_limited";

/**
 * Server OAuth config is wrong (invalid_client, unauthorized_client, invalid_request).
 * Not Needs reconnect. A later sync or apply can succeed once the secret is fixed.
 */
export const GOOGLE_CONFIG_ERROR = "google.config_error";

export const GOOGLE_RECONNECT_REQUIRED = "google.reconnect_required";

const GOOGLE_UNAVAILABLE = "Google didn't answer. Cerevex will try again later.";

/**
 * Refresh was rejected. The message is the status code only.
 * The Google body is never copied in.
 */
export class GoogleRefreshRejected extends Error {
  readonly code = GOOGLE_REFRESH_REJECTED;

  constructor() {
    super(GOOGLE_REFRESH_REJECTED);
    this.name = "GoogleRefreshRejected";
  }
}

/**
 * Wrong client id or secret, or another token-endpoint 4xx that is not invalid_grant.
 * The message is the config code only. oauthError is a short OAuth code, never a body.
 */
export class GoogleOAuthConfigError extends Error {
  readonly code = GOOGLE_CONFIG_ERROR;
  readonly oauthError: string;

  constructor(oauthError: string) {
    super(GOOGLE_CONFIG_ERROR);
    this.name = "GoogleOAuthConfigError";
    this.oauthError = oauthError;
  }
}

/**
 * 429, 5xx, a network failure, or a token response with no access token.
 * Retry later. Do not mark Needs reconnect.
 * The message is a fixed sentence or the rate-limit code. No response body.
 */
export class GoogleRetryLater extends Error {
  readonly status: number;

  constructor(status: number) {
    super(status === 429 ? GOOGLE_RATE_LIMITED : GOOGLE_UNAVAILABLE);
    this.name = "GoogleRetryLater";
    this.status = status;
  }
}

export function isGoogleRefreshRejected(error: unknown): error is GoogleRefreshRejected {
  return error instanceof GoogleRefreshRejected;
}

export function isGoogleRetryLater(error: unknown): error is GoogleRetryLater {
  return error instanceof GoogleRetryLater;
}

export function isGoogleOAuthConfigError(error: unknown): error is GoogleOAuthConfigError {
  return error instanceof GoogleOAuthConfigError;
}

/**
 * One reconnect audit per transition. A second sync or apply does not add another row.
 * Returns true when this call wrote the row.
 */
export async function markGoogleReconnectRequired(adAccountId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(adAccounts).where(eq(adAccounts.id, adAccountId)).for("update");
    if (!row || row.connectionStatus === "disconnected") return false;
    const alreadyNoted =
      row.connectionStatus === "needs_reconnect" || row.lastError === GOOGLE_REFRESH_REJECTED;
    if (row.connectionStatus !== "needs_reconnect" || row.lastError !== GOOGLE_REFRESH_REJECTED) {
      await tx
        .update(adAccounts)
        .set({ connectionStatus: "needs_reconnect", lastError: GOOGLE_REFRESH_REJECTED })
        .where(eq(adAccounts.id, row.id));
    }
    if (alreadyNoted) return false;
    await writeAuditEvent(
      {
        workspaceId: row.workspaceId,
        actorType: "system",
        action: GOOGLE_RECONNECT_REQUIRED,
        entityType: "ad_account",
        entityId: row.id,
        payload: { platform: "google", code: GOOGLE_REFRESH_REJECTED, clientId: row.clientId },
      },
      tx,
    );
    return true;
  });
}

/** Apply outcome for a Google refresh failure. Does not include the Google body. */
export async function googleMutationFailure(
  adAccountId: string,
  mutation: ApplyMutation,
  error: unknown,
): Promise<MutationOutcome | null> {
  if (isGoogleRefreshRejected(error)) {
    await markGoogleReconnectRequired(adAccountId);
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: GOOGLE_REFRESH_REJECTED,
    };
  }
  if (isGoogleOAuthConfigError(error)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: GOOGLE_CONFIG_ERROR,
    };
  }
  if (isGoogleRetryLater(error)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: error.message,
    };
  }
  return null;
}
