import { and, eq, ne } from "drizzle-orm";
import type { ApplyMutation } from "./audit-schemas";
import { writeAuditEvent } from "./audit";
import { getAdPlatformConnector } from "./connectors";
import { storeTokens, tokenNearExpiry } from "./credentials";
import { getDb } from "./db";
import {
  META_PERMISSION_MISSING,
  META_RATE_LIMITED,
  META_TOKEN_EXPIRED,
  MetaRefreshError,
  isMetaPermissionMissing,
  isMetaRateLimited,
  isMetaTokenExpired,
  metaExpiryBand,
  metaTokenExpiredError,
} from "./meta-graph-error";
import type { MutationOutcome } from "./mutate-types";
import { adAccounts } from "./schema";
import type { StoredOAuthTokens } from "./types";

/**
 * One reconnect audit per transition. A second sync or apply does not add another row.
 * Returns true when this call wrote the row.
 */
export async function markMetaReconnectRequired(adAccountId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(adAccounts).where(eq(adAccounts.id, adAccountId)).for("update");
    if (!row || row.connectionStatus === "disconnected") return false;
    if (row.connectionStatus === "needs_reconnect" && row.lastError === META_TOKEN_EXPIRED) return false;
    await tx
      .update(adAccounts)
      .set({ connectionStatus: "needs_reconnect", lastError: META_TOKEN_EXPIRED })
      .where(eq(adAccounts.id, row.id));
    await writeAuditEvent(
      {
        workspaceId: row.workspaceId,
        actorType: "system",
        action: "meta.reconnect_required",
        entityType: "ad_account",
        entityId: row.id,
        payload: { platform: "meta", code: META_TOKEN_EXPIRED, clientId: row.clientId },
      },
      tx,
    );
    return true;
  });
}

export async function noteMetaAccountCode(adAccountId: string, code: string): Promise<void> {
  await getDb()
    .update(adAccounts)
    .set({ lastError: code })
    .where(
      and(
        eq(adAccounts.id, adAccountId),
        ne(adAccounts.connectionStatus, "disconnected"),
        ne(adAccounts.connectionStatus, "needs_reconnect"),
      ),
    );
}

/**
 * Shared refresh-before-use hook. Meta never treats the stored token as a successful refresh.
 * Google still returns its previous token when its refresh fails; G4 tightens that later.
 */
export async function ensureFreshPlatformTokens(input: {
  adAccountId: string;
  tokens: StoredOAuthTokens;
}): Promise<StoredOAuthTokens> {
  if (input.tokens.mock) return input.tokens;
  const account = await getDb().query.adAccounts.findFirst({
    where: eq(adAccounts.id, input.adAccountId),
  });
  if (!account) return input.tokens;

  if (account.platform === "meta") {
    if (account.connectionStatus === "needs_reconnect" || account.lastError === META_TOKEN_EXPIRED) {
      throw metaTokenExpiredError();
    }
    if (metaExpiryBand(input.tokens.expiresAt) === "expired") {
      await markMetaReconnectRequired(account.id);
      throw metaTokenExpiredError();
    }
  }

  if (!tokenNearExpiry(input.tokens)) return input.tokens;

  const connector = getAdPlatformConnector(account.platform);
  let refreshed: StoredOAuthTokens;
  try {
    refreshed = await connector.refreshTokens(input.tokens);
  } catch (error) {
    if (account.platform === "meta" && isMetaTokenExpired(error)) {
      await markMetaReconnectRequired(account.id);
    }
    throw error;
  }

  const unchanged =
    refreshed.accessToken === input.tokens.accessToken && refreshed.expiresAt === input.tokens.expiresAt;
  if (unchanged) {
    if (account.platform === "meta") throw new MetaRefreshError();
    return input.tokens;
  }

  await storeTokens({
    workspaceId: account.workspaceId,
    clientId: account.clientId,
    adAccountId: account.id,
    platform: account.platform,
    label: refreshed.mock ? "mock" : "live",
    tokens: refreshed,
  });

  if (account.platform === "meta") {
    await writeAuditEvent({
      workspaceId: account.workspaceId,
      actorType: "system",
      action: "meta.token_extended",
      entityType: "ad_account",
      entityId: account.id,
      payload: { platform: "meta", expiresAt: refreshed.expiresAt ?? null },
    });
  }

  return refreshed;
}

export async function metaMutationFailure(
  adAccountId: string,
  mutation: ApplyMutation,
  error: unknown,
): Promise<MutationOutcome | null> {
  if (isMetaTokenExpired(error)) {
    await markMetaReconnectRequired(adAccountId);
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: META_TOKEN_EXPIRED,
    };
  }
  if (isMetaRateLimited(error)) {
    await noteMetaAccountCode(adAccountId, META_RATE_LIMITED);
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: META_RATE_LIMITED,
    };
  }
  if (isMetaPermissionMissing(error)) {
    await noteMetaAccountCode(adAccountId, META_PERMISSION_MISSING);
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: META_PERMISSION_MISSING,
    };
  }
  if (error instanceof MetaRefreshError) {
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
