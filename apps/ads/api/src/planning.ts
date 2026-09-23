import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  buildWeeklyNarrative,
  isBookedJobSignalVisible,
  isCallAttributionVisible,
  isCapabilityVisible,
  isLeadLifecycleVisible,
  isOwnerWeeklyNarrativeVisible,
  isSeasonalityCalendarVisible,
  parseOfferWindow,
  publicSeasonalityView,
  publicWeeklyNarrativeView,
  summarizeWeeklyMetrics,
  type OfferWindow,
} from "@tharros/ads-shared";
import { writeAuditEvent } from "@tharros/ads-shared/audit";
import {
  loadWorkspaceSettings,
  resolveCallTrackingForClient,
} from "@tharros/ads-shared/connector-settings";
import { getDb } from "@tharros/ads-shared/db";
import { loadWorkspacePlanning, saveWorkspaceSeasonality } from "@tharros/ads-shared/planning-settings";
import { adEntities, adMetrics } from "@tharros/ads-shared/schema";
import { loadWorkspaceCapabilities, requireWritableCapability } from "./capabilities";
import { requireMutableClient } from "./connect";
import { childLogger } from "./logger";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const saveCalendarSchema = z.object({
  clientId: z.string().uuid(),
  windows: z.array(z.unknown()).min(1).max(24),
});

async function metricsForClient(clientId: string): Promise<{
  entities: Array<{ entityType: string; externalId: string; name: string; status: string }>;
  metrics: Array<{
    entityExternalId: string;
    entityType: string;
    window: string;
    spendUsd: string;
    impressions: number;
    clicks: number;
    conversions: string;
  }>;
}> {
  const entityRows = await getDb().select().from(adEntities).where(eq(adEntities.clientId, clientId));
  const metricRows = await getDb().select().from(adMetrics).where(eq(adMetrics.clientId, clientId));
  return {
    entities: entityRows.map((row) => ({
      entityType: row.entityType,
      externalId: row.externalId,
      name: row.name,
      status: row.status,
    })),
    metrics: metricRows.map((row) => {
      const entity = entityRows.find((item) => item.id === row.entityId);
      return {
        entityExternalId: entity?.externalId ?? row.entityId,
        entityType: entity?.entityType ?? "unknown",
        window: row.window,
        spendUsd: String(row.spendUsd),
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: String(row.conversions),
      };
    }),
  };
}

export function registerPlanningRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/planning", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    const seasonalityOn = isSeasonalityCalendarVisible(flags);
    const narrativeOn = isOwnerWeeklyNarrativeVisible(flags);
    if (!seasonalityOn && !narrativeOn) {
      return c.json({
        visible: false,
        seasonality: null,
        narrative: null,
        email: false,
        writes: false,
      });
    }
    const { planning } = await loadWorkspacePlanning(client.workspaceId);
    let narrative = null;
    if (narrativeOn) {
      const pulled = await metricsForClient(client.id);
      const { connectors } = await loadWorkspaceSettings(client.workspaceId);
      const tracking = resolveCallTrackingForClient(connectors, client.id, flags);
      const crm = connectors.crm[client.id];
      narrative = publicWeeklyNarrativeView(
        buildWeeklyNarrative(
          summarizeWeeklyMetrics({
            ...pulled,
            calls: tracking.calls,
            bookedJobs: crm?.bookedJobs ?? [],
            leads: crm?.leads ?? [],
            callTrackingVisible: isCallAttributionVisible(flags),
            bookedVisible: isBookedJobSignalVisible(flags) || isCapabilityVisible("m52.crm_join", flags),
            leadLifecycleVisible: isLeadLifecycleVisible(flags),
          }),
        ),
      );
    }
    return c.json({
      visible: true,
      seasonality: seasonalityOn ? publicSeasonalityView(planning.seasonality) : null,
      narrative,
      email: false,
      writes: false,
    });
  });

  app.post("/clients/:id/planning/calendar", requireAuth, async (c) => {
    const parsed = saveCalendarSchema.safeParse({
      ...(await c.req.json().catch(() => ({}))),
      clientId: c.req.param("id"),
    });
    if (!parsed.success) {
      throw new HTTPException(400, { message: "windows must be a non-empty list of calendar windows." });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.seasonality_calendar");
    const windows: OfferWindow[] = [];
    for (const row of parsed.data.windows) {
      const next = parseOfferWindow(row);
      if (next) windows.push(next);
    }
    if (windows.length === 0) {
      throw new HTTPException(400, { message: "No valid calendar windows. Name, dates, and intent are required." });
    }
    const saved = await saveWorkspaceSeasonality(client.workspaceId, windows);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "planning.seasonality_saved",
      entityType: "workspace",
      entityId: client.workspaceId,
      payload: { clientId: client.id, windowCount: saved.seasonality.windows.length, writes: false },
    });
    childLogger(c.get("requestId")).info({
      msg: "planning.seasonality_saved",
      clientId: client.id,
      windowCount: saved.seasonality.windows.length,
      writes: false,
    });
    return c.json({
      ok: true,
      seasonality: publicSeasonalityView(saved.seasonality),
      writes: false,
    });
  });
}
