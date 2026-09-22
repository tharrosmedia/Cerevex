import { eq } from "drizzle-orm";
import type { AdAccountPublic, AdEntityPublic, AuthContext, Platform } from "@tharros/ads-shared";
import { canMutate } from "@tharros/ads-shared";
import { loadTokens, publicTokenView, storeTokens } from "@tharros/ads-shared/credentials";
import { getDb } from "@tharros/ads-shared/db";
import { adAccountSyncEvent, sendAdAccountSync } from "@tharros/ads-shared/inngest";
import { adAccounts, adEntities, adMetrics, clients } from "@tharros/ads-shared/schema";
import { HTTPException } from "hono/http-exception";
import { getVisibleClient } from "./tenancy";

export function toPublicAccount(
  row: typeof adAccounts.$inferSelect,
  tokens: Awaited<ReturnType<typeof loadTokens>>,
): AdAccountPublic {
  const view = publicTokenView(tokens);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    platform: row.platform,
    externalId: row.externalId,
    connectionStatus: row.connectionStatus,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastError: row.lastError,
    hasCredentials: view.hasCredentials,
    mock: view.mock,
    scopes: (row.scopesJson as string[] | null) ?? view.scopes,
  };
}

export async function listPublicAdAccounts(clientId: string): Promise<AdAccountPublic[]> {
  const rows = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, clientId));
  const out: AdAccountPublic[] = [];
  for (const row of rows) {
    const tokens = await loadTokens(row.id);
    out.push(toPublicAccount(row, tokens));
  }
  return out;
}

export async function requireMutableClient(auth: AuthContext, clientId: string) {
  const client = await getVisibleClient(auth, clientId);
  if (!client) {
    throw new HTTPException(404, { message: "Client not found" });
  }
  if (!canMutate(auth, client.workspaceId)) {
    throw new HTTPException(403, { message: "Owner or operator role required" });
  }
  return client;
}

export async function upsertConnectedAccount(input: {
  workspaceId: string;
  clientId: string;
  platform: Platform;
  externalId: string;
  scopes: string[];
  tokens: Parameters<typeof storeTokens>[0]["tokens"];
  label: string;
}) {
  const db = getDb();
  const matches = await db.select().from(adAccounts).where(eq(adAccounts.clientId, input.clientId));
  const match = matches.find((row) => row.platform === input.platform);

  const values = {
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    platform: input.platform,
    externalId: input.externalId,
    connectionStatus: "connected" as const,
    lastError: null,
    scopesJson: input.scopes,
  };

  const row = match
    ? (
        await db.update(adAccounts).set(values).where(eq(adAccounts.id, match.id)).returning()
      )[0]
    : (await db.insert(adAccounts).values(values).returning())[0];

  await storeTokens({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    adAccountId: row.id,
    platform: input.platform,
    label: input.label,
    tokens: input.tokens,
  });

  return row;
}

export async function enqueueAccountSync(auth: AuthContext, adAccountId: string) {
  const db = getDb();
  const account = await db.query.adAccounts.findFirst({
    where: eq(adAccounts.id, adAccountId),
  });
  if (!account) {
    throw new HTTPException(404, { message: "Ad account not found" });
  }
  const client = await requireMutableClient(auth, account.clientId);
  const ids = await sendAdAccountSync({
    requestedBy: auth.user.id,
    workspaceId: client.workspaceId,
    clientId: client.id,
    adAccountId: account.id,
    platform: account.platform,
  });
  return {
    jobId: ids[0] ?? "unknown",
    adAccountId: account.id,
    name: adAccountSyncEvent(account.platform),
  };
}

export async function listEntities(adAccountId: string): Promise<AdEntityPublic[]> {
  const db = getDb();
  const entities = await db.select().from(adEntities).where(eq(adEntities.adAccountId, adAccountId));
  const metrics = await db.select().from(adMetrics).where(eq(adMetrics.adAccountId, adAccountId));
  return entities.map((entity) => ({
    id: entity.id,
    entityType: entity.entityType,
    externalId: entity.externalId,
    name: entity.name,
    status: entity.status,
    parentExternalId: entity.parentExternalId,
    metrics: metrics
      .filter((m) => m.entityId === entity.id)
      .map((m) => ({
        window: m.window,
        spendUsd: String(m.spendUsd),
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: String(m.conversions),
      })),
  }));
}

export async function clientConnectionSummary(clientId: string) {
  const rows = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, clientId));
  return {
    connectedPlatforms: rows
      .filter((row) => row.connectionStatus === "connected" || row.connectionStatus === "syncing")
      .map((row) => row.platform),
    lastSyncAt: rows
      .map((row) => row.lastSyncAt)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null,
  };
}

export async function requireVisibleAccount(auth: AuthContext, adAccountId: string) {
  const account = await getDb().query.adAccounts.findFirst({
    where: eq(adAccounts.id, adAccountId),
  });
  if (!account) return null;
  const client = await getVisibleClient(auth, account.clientId);
  if (!client) return null;
  return account;
}
