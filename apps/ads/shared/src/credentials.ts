import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb } from "./db";
import { oauthCredentials } from "./schema";
import type { Platform, StoredOAuthTokens } from "./types";

type TokenDb = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;

export function publicTokenView(tokens: StoredOAuthTokens | null): {
  hasCredentials: boolean;
  mock: boolean;
  expiresAt: string | null;
  scopes: string[];
} {
  return {
    hasCredentials: Boolean(tokens),
    mock: Boolean(tokens?.mock),
    expiresAt: tokens?.expiresAt ?? null,
    scopes: tokens?.scopes ?? [],
  };
}

export async function storeTokens(input: {
  workspaceId: string;
  clientId: string;
  adAccountId: string;
  platform: Platform;
  label: string;
  tokens: StoredOAuthTokens;
}, db: TokenDb = getDb()): Promise<void> {
  const encryptedPayload = encryptSecret(JSON.stringify(input.tokens));
  const [existing] = await db
    .select({ id: oauthCredentials.id })
    .from(oauthCredentials)
    .where(
      and(eq(oauthCredentials.adAccountId, input.adAccountId), eq(oauthCredentials.platform, input.platform)),
    );
  if (existing) {
    await db
      .update(oauthCredentials)
      .set({
        encryptedPayload,
        label: input.label,
        updatedAt: new Date(),
      })
      .where(eq(oauthCredentials.id, existing.id));
    return;
  }
  await db.insert(oauthCredentials).values({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    adAccountId: input.adAccountId,
    platform: input.platform,
    label: input.label,
    encryptedPayload,
  });
}

export async function loadTokens(
  adAccountId: string,
  db: Pick<ReturnType<typeof getDb>, "query"> = getDb(),
): Promise<StoredOAuthTokens | null> {
  const row = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.adAccountId, adAccountId),
  });
  if (!row?.encryptedPayload) return null;
  const parsed = JSON.parse(decryptSecret(row.encryptedPayload)) as StoredOAuthTokens;
  if (!parsed.accessToken) return null;
  return parsed;
}

export function tokenNearExpiry(tokens: StoredOAuthTokens, skewMs = 5 * 60 * 1000): boolean {
  if (!tokens.expiresAt) return false;
  return new Date(tokens.expiresAt).getTime() - Date.now() < skewMs;
}
