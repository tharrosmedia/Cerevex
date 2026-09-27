import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { AccessibleAdAccount, Platform, StoredOAuthTokens } from "@tharros/ads-shared";
import { decryptSecret, encryptSecret } from "@tharros/ads-shared/crypto";
import { getDb } from "@tharros/ads-shared/db";
import { sendAdAccountSync } from "@tharros/ads-shared/inngest";
import { GOOGLE_SCOPES, META_SCOPES } from "@tharros/ads-shared/oauth";
import { adAccounts, oauthPendingConnections } from "@tharros/ads-shared/schema";
import { requireMutableClient, upsertConnectedAccount } from "./connect";
import type { AppEnv } from "./types";

const PENDING_TTL_MS = 60 * 60 * 1000;

type PendingPayload = { tokens: StoredOAuthTokens; accounts: AccessibleAdAccount[] };

const selectSchema = z.object({ externalIds: z.array(z.string().min(1)).min(1).max(50) });

export async function createPendingConnection(input: {
  workspaceId: string;
  clientId: string;
  platform: Platform;
  userId: string;
  tokens: StoredOAuthTokens;
  accounts: AccessibleAdAccount[];
}): Promise<string> {
  const db = getDb();
  await db.delete(oauthPendingConnections).where(lt(oauthPendingConnections.expiresAt, new Date()));
  const payload: PendingPayload = { tokens: input.tokens, accounts: input.accounts };
  const [row] = await db
    .insert(oauthPendingConnections)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      platform: input.platform,
      userId: input.userId,
      encryptedPayload: encryptSecret(JSON.stringify(payload)),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    })
    .returning({ id: oauthPendingConnections.id });
  return row.id;
}

async function loadPending(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const row = await getDb().query.oauthPendingConnections.findFirst({
    where: eq(oauthPendingConnections.id, id),
  });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const payload = JSON.parse(decryptSecret(row.encryptedPayload)) as PendingPayload;
  return { row, payload };
}

/** Connects the chosen accounts to the client and starts a first sync for each. */
export async function connectChosenAccounts(input: {
  workspaceId: string;
  clientId: string;
  platform: Platform;
  requestedBy: string;
  tokens: StoredOAuthTokens;
  accounts: AccessibleAdAccount[];
}) {
  const rows = [];
  for (const account of input.accounts) {
    const row = await upsertConnectedAccount({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      platform: input.platform,
      externalId: account.externalId,
      displayName: account.name,
      scopes: input.platform === "meta" ? META_SCOPES : GOOGLE_SCOPES,
      tokens: account.loginCustomerId ? { ...input.tokens, loginCustomerId: account.loginCustomerId } : input.tokens,
      label: "live",
    });
    await sendAdAccountSync({
      requestedBy: input.requestedBy,
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      adAccountId: row.id,
      platform: input.platform,
    }).catch(() => undefined);
    rows.push(row);
  }
  return rows;
}

export function registerPendingConnectRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/oauth/pending/:id", requireAuth, async (c) => {
    const pending = await loadPending(c.req.param("id"));
    if (!pending) throw new HTTPException(404, { message: "This connection expired. Connect again." });
    const client = await requireMutableClient(c.get("auth"), pending.row.clientId);
    const existing = await getDb()
      .select({ externalId: adAccounts.externalId })
      .from(adAccounts)
      .where(and(eq(adAccounts.clientId, client.id), eq(adAccounts.platform, pending.row.platform)));
    const connected = new Set(existing.map((r) => r.externalId));
    return c.json({
      id: pending.row.id,
      platform: pending.row.platform,
      client: { id: client.id, name: client.name, siteId: client.siteId ?? null },
      expiresAt: pending.row.expiresAt.toISOString(),
      accounts: pending.payload.accounts.map((account) => ({
        externalId: account.externalId,
        name: account.name,
        currency: account.currency ?? null,
        detail: account.detail ?? null,
        alreadyConnected: connected.has(account.externalId),
      })),
    });
  });

  app.post("/oauth/pending/:id/select", requireAuth, async (c) => {
    const parsed = selectSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "Choose at least one account." });
    const pending = await loadPending(c.req.param("id"));
    if (!pending) throw new HTTPException(404, { message: "This connection expired. Connect again." });
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, pending.row.clientId);
    const wanted = new Set(parsed.data.externalIds);
    const chosen = pending.payload.accounts.filter((account) => wanted.has(account.externalId));
    if (chosen.length === 0) throw new HTTPException(400, { message: "Those accounts aren't available on this login." });
    const rows = await connectChosenAccounts({
      workspaceId: client.workspaceId,
      clientId: client.id,
      platform: pending.row.platform,
      requestedBy: auth.user.id,
      tokens: pending.payload.tokens,
      accounts: chosen,
    });
    await getDb().delete(oauthPendingConnections).where(eq(oauthPendingConnections.id, pending.row.id));
    return c.json({
      connected: rows.length,
      platform: pending.row.platform,
      clientId: client.id,
      adAccountIds: rows.map((row) => row.id),
    });
  });
}