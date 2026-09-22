import { and, eq } from "drizzle-orm";
import { loadTokens, storeTokens, tokenNearExpiry } from "./credentials";
import { getDb } from "./db";
import { isGoogleConfigured, isMetaConfigured } from "./oauth";
import { pullAdAccount, refreshTokensIfNeeded } from "./platforms";
import { adAccounts, adEntities, adMetrics, clients } from "./schema";
import type { Platform } from "./types";

export type SyncResult = {
  adAccountId: string;
  mode: "mock" | "live";
  entityCount: number;
  status: "connected" | "error";
  lastError: string | null;
};

function liveAllowed(platform: Platform): boolean {
  if (process.env.PLATFORM_SYNC_LIVE === "0") return false;
  return platform === "meta" ? isMetaConfigured() : isGoogleConfigured();
}

export async function runAdAccountSync(adAccountId: string): Promise<SyncResult> {
  const db = getDb();
  const account = await db.query.adAccounts.findFirst({
    where: eq(adAccounts.id, adAccountId),
  });
  if (!account) {
    throw new Error("Ad account not found");
  }

  await db
    .update(adAccounts)
    .set({ connectionStatus: "syncing", lastError: null })
    .where(eq(adAccounts.id, adAccountId));

  try {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, account.clientId),
    });
    let tokens = await loadTokens(adAccountId);
    if (!tokens) {
      throw new Error("No OAuth credentials for this ad account");
    }
    if (tokenNearExpiry(tokens)) {
      const refreshed = await refreshTokensIfNeeded(account.platform, tokens);
      if (refreshed.accessToken !== tokens.accessToken) {
        await storeTokens({
          workspaceId: account.workspaceId,
          clientId: account.clientId,
          adAccountId,
          platform: account.platform,
          label: tokens.mock ? "mock" : "live",
          tokens: refreshed,
        });
        tokens = refreshed;
      }
    }

    const pulled = await pullAdAccount({
      platform: account.platform,
      tokens,
      externalId: account.externalId,
      clientName: client?.name ?? "Pilot",
      allowLive: liveAllowed(account.platform) && !tokens.mock,
    });

    await db.delete(adEntities).where(eq(adEntities.adAccountId, adAccountId));

    const inserted = [];
    for (const entity of pulled.entities) {
      const [row] = await db
        .insert(adEntities)
        .values({
          workspaceId: account.workspaceId,
          clientId: account.clientId,
          adAccountId,
          platform: account.platform,
          entityType: entity.entityType,
          externalId: entity.externalId,
          name: entity.name,
          status: entity.status,
          parentExternalId: entity.parentExternalId,
          rawJson: { source: pulled.mode },
        })
        .returning();
      inserted.push(row);
    }

    for (const metric of pulled.metrics) {
      const entity = inserted.find(
        (row) => row.externalId === metric.entityExternalId && row.entityType === metric.entityType,
      );
      if (!entity) continue;
      await db.insert(adMetrics).values({
        workspaceId: account.workspaceId,
        clientId: account.clientId,
        adAccountId,
        entityId: entity.id,
        window: metric.window,
        spendUsd: metric.spendUsd,
        impressions: metric.impressions,
        clicks: metric.clicks,
        conversions: metric.conversions,
        rawJson: { source: pulled.mode },
      });
    }

    await db
      .update(adAccounts)
      .set({
        connectionStatus: "connected",
        lastSyncAt: new Date(),
        lastError: null,
        externalId: pulled.externalAccountId,
      })
      .where(eq(adAccounts.id, adAccountId));

    return {
      adAccountId,
      mode: pulled.mode,
      entityCount: pulled.entities.length,
      status: "connected",
      lastError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await db
      .update(adAccounts)
      .set({
        connectionStatus: "error",
        lastError: message,
      })
      .where(and(eq(adAccounts.id, adAccountId)));
    return {
      adAccountId,
      mode: "mock",
      entityCount: 0,
      status: "error",
      lastError: message,
    };
  }
}
