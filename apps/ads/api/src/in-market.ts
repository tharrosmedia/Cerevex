import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { buildInMarketView, isCapabilityVisible, type InMarketPlatform } from "@tharros/ads-shared";
import { getDb } from "@tharros/ads-shared/db";
import { adEntities, adMetrics } from "@tharros/ads-shared/schema";
import { loadWorkspaceCapabilities } from "./capabilities";
import { listPublicAdAccounts } from "./connect";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

function asPlatform(value: string): InMarketPlatform | null {
  return value === "meta" || value === "google" ? value : null;
}

/**
 * Read-only inventory. Never writes, never calls Approve/apply, and a hidden
 * flag returns `{ visible: false }` instead of failing the shell.
 */
export function registerInMarketRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/in-market", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    if (!isCapabilityVisible("in_market", flags)) {
      return c.json({ visible: false as const });
    }

    const accounts = await listPublicAdAccounts(client.id);
    const entityRows = await getDb().select().from(adEntities).where(eq(adEntities.clientId, client.id));
    const metricRows = await getDb().select().from(adMetrics).where(eq(adMetrics.clientId, client.id));

    const view = buildInMarketView({
      window: c.req.query("window"),
      accounts: accounts.flatMap((account) => {
        const platform = asPlatform(account.platform);
        if (!platform) return [];
        return [
          {
            id: account.id,
            platform,
            externalId: account.externalId,
            displayName: account.displayName,
            connectionStatus: account.connectionStatus,
            lastSyncAt: account.lastSyncAt,
            hasCredentials: account.hasCredentials,
          },
        ];
      }),
      entities: entityRows.flatMap((row) => {
        const platform = asPlatform(row.platform);
        if (!platform) return [];
        const raw = row.rawJson && typeof row.rawJson === "object" && !Array.isArray(row.rawJson)
          ? (row.rawJson as Record<string, unknown>)
          : {};
        return [
          {
            id: row.id,
            adAccountId: row.adAccountId,
            platform,
            entityType: row.entityType,
            externalId: row.externalId,
            name: row.name,
            status: row.status,
            parentExternalId: row.parentExternalId,
            syncedAt: row.syncedAt.toISOString(),
            raw,
          },
        ];
      }),
      metrics: metricRows.map((row) => ({
        entityId: row.entityId,
        window: row.window,
        spendUsd: String(row.spendUsd),
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: String(row.conversions),
      })),
    });

    return c.json(view);
  });
}
