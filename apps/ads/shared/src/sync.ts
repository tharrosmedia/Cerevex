import { and, eq, ne } from "drizzle-orm";
import { resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { getAdPlatformConnector } from "./connectors";
import { loadTokens, storeTokens, tokenNearExpiry } from "./credentials";
import { getDb } from "./db";
import { platformSyncLiveEnabled } from "./flags";
import { realTokenLiveBlock } from "./live-or-loud";
import { adAccounts, adEntities, adMetrics, clients, workspaces } from "./schema";

export type SyncResult = {
  adAccountId: string;
  mode: "mock" | "live";
  entityCount: number;
  status: "connected" | "error" | "skipped";
  lastError: string | null;
};

/** Audit label for a finished sync. A disconnected account is a no-op, not a failure. */
export function syncJobAuditAction(status: SyncResult["status"]): "jobs.sync_failed" | "jobs.sync_skipped" | "jobs.sync_complete" {
  if (status === "error") return "jobs.sync_failed";
  if (status === "skipped") return "jobs.sync_skipped";
  return "jobs.sync_complete";
}

function skippedSync(adAccountId: string): SyncResult {
  return {
    adAccountId,
    mode: "mock",
    entityCount: 0,
    status: "skipped",
    lastError: null,
  };
}

export async function runAdAccountSync(adAccountId: string): Promise<SyncResult> {
  const db = getDb();
  const account = await db.query.adAccounts.findFirst({
    where: eq(adAccounts.id, adAccountId),
  });
  if (!account) {
    throw new Error("Ad account not found");
  }
  if (account.connectionStatus === "disconnected") {
    return skippedSync(adAccountId);
  }

  const stillSyncing = and(eq(adAccounts.id, adAccountId), ne(adAccounts.connectionStatus, "disconnected"));
  const [markedSyncing] = await db
    .update(adAccounts)
    .set({ connectionStatus: "syncing", lastError: null })
    .where(stillSyncing)
    .returning({ id: adAccounts.id });
  if (!markedSyncing) return skippedSync(adAccountId);

  try {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, account.clientId),
    });
    let tokens = await loadTokens(adAccountId);
    if (!tokens) {
      throw new Error("No OAuth credentials for this ad account");
    }
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, account.workspaceId),
    });
    const capabilities = resolveWorkspaceCapabilities(workspace?.settingsJson);
    const connector = getAdPlatformConnector(account.platform);
    const block = realTokenLiveBlock({
      platform: account.platform,
      mock: tokens.mock,
      configured: connector.isConfigured(),
      syncLive: platformSyncLiveEnabled(capabilities),
    });
    if (block) {
      const lastError = block.kind === "not_configured" ? block.code : block.syncReason;
      const [updated] = await db
        .update(adAccounts)
        .set({
          connectionStatus: block.kind === "not_configured" ? "error" : account.connectionStatus,
          lastError,
        })
        .where(and(eq(adAccounts.id, adAccountId), ne(adAccounts.connectionStatus, "disconnected")))
        .returning({ id: adAccounts.id });
      if (!updated) return skippedSync(adAccountId);
      return {
        adAccountId,
        mode: "live",
        entityCount: 0,
        status: block.kind === "not_configured" ? "error" : "skipped",
        lastError,
      };
    }
    if (tokenNearExpiry(tokens)) {
      const currentTokens = tokens;
      const refreshed = await connector.refreshTokens(currentTokens);
      if (refreshed.accessToken !== currentTokens.accessToken) {
        const stored = await db.transaction(async (tx) => {
          const [locked] = await tx
            .select({ connectionStatus: adAccounts.connectionStatus })
            .from(adAccounts)
            .where(eq(adAccounts.id, adAccountId))
            .for("update");
          if (!locked || locked.connectionStatus === "disconnected") return false;
          await storeTokens(
            {
              workspaceId: account.workspaceId,
              clientId: account.clientId,
              adAccountId,
              platform: account.platform,
              label: currentTokens.mock ? "mock" : "live",
              tokens: refreshed,
            },
            tx,
          );
          return true;
        });
        if (!stored) return skippedSync(adAccountId);
        tokens = refreshed;
      }
    }

    const pulled = await connector.pull({
      platform: account.platform,
      tokens,
      externalId: account.externalId,
      clientName: client?.name ?? "Pilot",
      allowLive: connector.isLiveAllowed(tokens, capabilities),
    });

    const wrote = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ connectionStatus: adAccounts.connectionStatus })
        .from(adAccounts)
        .where(eq(adAccounts.id, adAccountId))
        .for("update");
      if (!locked || locked.connectionStatus === "disconnected") return false;

      await tx.delete(adEntities).where(eq(adEntities.adAccountId, adAccountId));

      const inserted = [];
      for (const entity of pulled.entities) {
        const [row] = await tx
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
            rawJson: { source: pulled.mode, ...(entity.raw ?? {}) },
          })
          .returning();
        inserted.push(row);
      }

      for (const metric of pulled.metrics) {
        const entity = inserted.find(
          (row) => row.externalId === metric.entityExternalId && row.entityType === metric.entityType,
        );
        if (!entity) continue;
        await tx.insert(adMetrics).values({
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

      const [connected] = await tx
        .update(adAccounts)
        .set({
          connectionStatus: "connected",
          lastSyncAt: new Date(),
          lastError: null,
          externalId: pulled.externalAccountId,
        })
        .where(and(eq(adAccounts.id, adAccountId), ne(adAccounts.connectionStatus, "disconnected")))
        .returning({ id: adAccounts.id });
      return Boolean(connected);
    });
    if (!wrote) return skippedSync(adAccountId);

    return {
      adAccountId,
      mode: pulled.mode,
      entityCount: pulled.entities.length,
      status: "connected",
      lastError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    const [errored] = await db
      .update(adAccounts)
      .set({
        connectionStatus: "error",
        lastError: message,
      })
      .where(and(eq(adAccounts.id, adAccountId), ne(adAccounts.connectionStatus, "disconnected")))
      .returning({ id: adAccounts.id });
    if (!errored) return skippedSync(adAccountId);
    return {
      adAccountId,
      mode: "mock",
      entityCount: 0,
      status: "error",
      lastError: message,
    };
  }
}
