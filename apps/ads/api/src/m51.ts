import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { isCapabilityVisible } from "@tharros/ads-shared";
import { toRecommendationPublic } from "@tharros/ads-shared/audit";
import {
  disconnectAnalyticsConnection,
  listAnalyticsConnections,
  loadFunnelSignal,
  pixelScript,
  recordFunnelEvent,
  upsertAnalyticsConnection,
} from "@tharros/ads-shared/analytics";
import { analyzeCopySentiment, compareAdsInGroup, otherPlatform } from "@tharros/ads-shared/creative-analysis";
import { generateGrokAlternative, listGrokIdeas, promoteGrokIdea, saveGrokIdea } from "@tharros/ads-shared/grok-creatives";
import { getDb } from "@tharros/ads-shared/db";
import { adAccounts, adEntities, adMetrics } from "@tharros/ads-shared/schema";
import { and, eq } from "drizzle-orm";
import { loadWorkspaceCapabilities, requireWritableCapability } from "./capabilities";
import { listPublicAdAccounts } from "./connect";
import { requireMutableClient } from "./connect";
import { getVisibleClient, listVisibleClients } from "./tenancy";
import type { AppEnv } from "./types";

const connectSchema = z.object({
  clientId: z.string().uuid().optional(),
  connectorId: z.enum(["ga4", "first_party"]),
  propertyId: z.string().max(80).optional(),
  measurementId: z.string().max(80).optional(),
  label: z.string().max(80).optional(),
});

const generateSchema = z.object({
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  targetPlatform: z.enum(["meta", "google"]).optional(),
});

const promoteSchema = z.object({
  clientId: z.string().uuid(),
  ideaId: z.string().uuid(),
  adAccountId: z.string().uuid().optional(),
});

const collectSchema = z.object({
  token: z.string().min(8),
  name: z.string().min(1).max(40),
  url: z.string().max(2000).optional().nullable(),
  referrer: z.string().max(2000).optional().nullable(),
  utmSource: z.string().max(200).optional().nullable(),
  utmCampaign: z.string().max(200).optional().nullable(),
  gclid: z.string().max(200).optional().nullable(),
  fbclid: z.string().max(200).optional().nullable(),
});

function corsStar(c: { header: (k: string, v: string) => void }) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
}

export function registerM51Routes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.options("/funnel/collect", (c) => {
    corsStar(c);
    return c.body(null, 204);
  });

  app.get("/funnel/pixel.js", async (c) => {
    corsStar(c);
    const token = c.req.query("token") ?? "";
    if (token.length < 8) {
      return c.text("// missing token", 400, { "content-type": "application/javascript" });
    }
    const origin = new URL(c.req.url).origin;
    return c.text(pixelScript(`${origin}/funnel/collect`, token), 200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
  });

  app.post("/funnel/collect", async (c) => {
    corsStar(c);
    const parsed = collectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ ok: false, error: "Invalid event" }, 400);
    }
    try {
      await recordFunnelEvent(parsed.data);
      return c.json({ ok: true, writes: false });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : "Could not record event" }, 400);
    }
  });

  app.get("/clients/:id/creatives", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) throw new HTTPException(404, { message: "Client not found" });
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    const visible =
      isCapabilityVisible("m51.grok_creatives", flags) ||
      isCapabilityVisible("m51.lp_congruence", flags) ||
      isCapabilityVisible("m51.budget_shift", flags);
    if (!visible) {
      return c.json({ creatives: [], analysis: [], enabled: false });
    }
    const accounts = await listPublicAdAccounts(client.id);
    const db = getDb();
    const creatives = [];
    for (const account of accounts) {
      const entities = await db.select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
      const metrics = await db.select().from(adMetrics).where(eq(adMetrics.adAccountId, account.id));
      for (const entity of entities.filter((row) => row.entityType === "ad")) {
        const raw = (entity.rawJson as Record<string, unknown>) ?? {};
        const entityMetrics = metrics
          .filter((row) => row.entityId === entity.id)
          .map((row) => ({
            window: row.window,
            spendUsd: String(row.spendUsd),
            impressions: row.impressions,
            clicks: row.clicks,
            conversions: String(row.conversions),
          }));
        const creative = {
          headline: typeof raw.headline === "string" ? raw.headline : null,
          body: typeof raw.body === "string" ? raw.body : null,
          imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
          landingPageUrl: typeof raw.landingPageUrl === "string" ? raw.landingPageUrl : null,
          offer: typeof raw.offer === "string" ? raw.offer : null,
        };
        creatives.push({
          id: entity.id,
          clientId: client.id,
          adAccountId: account.id,
          platform: account.platform,
          name: entity.name,
          status: entity.status,
          externalId: entity.externalId,
          parentExternalId: entity.parentExternalId,
          creative,
          sentiment: analyzeCopySentiment(creative),
          metrics: entityMetrics,
        });
      }
    }
    const analysis = compareAdsInGroup(
      creatives.map((row) => {
        const m30 = row.metrics.find((item) => item.window === "30d") ?? row.metrics[0];
        return {
          externalId: row.externalId,
          name: row.name,
          platform: row.platform,
          impressions: m30?.impressions ?? 0,
          clicks: m30?.clicks ?? 0,
          conversions: Number(m30?.conversions ?? 0),
          spendUsd: Number(m30?.spendUsd ?? 0),
        };
      }),
    );
    return c.json({ creatives, analysis, enabled: true });
  });

  app.get("/funnel", requireAuth, async (c) => {
    const auth = c.get("auth");
    const clients = await listVisibleClients(auth);
    const workspaceId = clients[0]?.workspaceId ?? auth.memberships[0]?.workspaceId;
    if (!workspaceId) return c.json({ connections: [], signal: null, enabled: false });
    const { flags } = await loadWorkspaceCapabilities(workspaceId);
    if (!isCapabilityVisible("m51.ga4_connect", flags)) {
      return c.json({ connections: [], signal: null, enabled: false });
    }
    const clientId = c.req.query("clientId");
    return c.json({
      connections: await listAnalyticsConnections(workspaceId, clientId),
      signal: await loadFunnelSignal(workspaceId, clientId),
      enabled: true,
    });
  });

  app.post("/funnel/connect", requireAuth, async (c) => {
    const parsed = connectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid funnel connect request" });
    const auth = c.get("auth");
    const client = parsed.data.clientId ? await requireMutableClient(auth, parsed.data.clientId) : null;
    const workspaceId = client?.workspaceId ?? auth.memberships[0]?.workspaceId;
    if (!workspaceId) throw new HTTPException(403, { message: "No workspace membership" });
    await requireWritableCapability(workspaceId, "m51.ga4_connect");
    const connection = await upsertAnalyticsConnection({
      workspaceId,
      clientId: client?.id ?? null,
      connectorId: parsed.data.connectorId,
      label: parsed.data.label,
      settings: {
        propertyId: parsed.data.propertyId,
        measurementId: parsed.data.measurementId,
      },
    });
    return c.json({ connection, writes: false });
  });

  app.post("/funnel/disconnect", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: string };
    const auth = c.get("auth");
    const workspaceId = auth.memberships[0]?.workspaceId;
    if (!workspaceId || !body.id) throw new HTTPException(400, { message: "Connection id required" });
    await requireWritableCapability(workspaceId, "m51.ga4_connect");
    const connection = await disconnectAnalyticsConnection(body.id, workspaceId);
    return c.json({ connection, writes: false });
  });

  app.get("/brainstorm/ideas", requireAuth, async (c) => {
    const auth = c.get("auth");
    const workspaceId = auth.memberships[0]?.workspaceId;
    if (!workspaceId) return c.json({ ideas: [], enabled: false });
    const { flags } = await loadWorkspaceCapabilities(workspaceId);
    if (!isCapabilityVisible("m51.brainstorm", flags) && !isCapabilityVisible("m51.grok_creatives", flags)) {
      return c.json({ ideas: [], enabled: false });
    }
    return c.json({
      ideas: await listGrokIdeas(workspaceId, c.req.query("clientId")),
      enabled: true,
    });
  });

  app.post("/brainstorm/generate", requireAuth, async (c) => {
    const parsed = generateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: "Client and ad are required" });
    const client = await requireMutableClient(c.get("auth"), parsed.data.clientId);
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    const canGenerate =
      flags["m51.grok_creatives"] === "on" || flags["m51.brainstorm"] === "on";
    if (!canGenerate) {
      throw new HTTPException(409, { message: "Grok creatives are off or recommend-only. Nothing was generated." });
    }
    const db = getDb();
    const entity = await db.query.adEntities.findFirst({
      where: and(eq(adEntities.id, parsed.data.entityId), eq(adEntities.clientId, client.id)),
    });
    if (!entity || entity.entityType !== "ad") {
      throw new HTTPException(404, { message: "Ad not found" });
    }
    const raw = (entity.rawJson as Record<string, unknown>) ?? {};
    const sourcePlatform = entity.platform;
    const targetPlatform = parsed.data.targetPlatform ?? otherPlatform(sourcePlatform);
    const alternative = await generateGrokAlternative({
      source: {
        name: entity.name,
        headline: typeof raw.headline === "string" ? raw.headline : entity.name,
        body: typeof raw.body === "string" ? raw.body : null,
        offer: typeof raw.offer === "string" ? raw.offer : null,
        imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
      },
      sourcePlatform,
      targetPlatform,
      clientName: client.name,
      sourceAdExternalId: entity.externalId,
    });
    const saved = await saveGrokIdea({
      workspaceId: client.workspaceId,
      clientId: client.id,
      title: `${entity.name} → ${targetPlatform}`,
      alternative,
      sourceAdExternalId: entity.externalId,
    });
    return c.json({ ...saved, writes: false });
  });

  app.post("/brainstorm/promote", requireAuth, async (c) => {
    const parsed = promoteSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(400, { message: "Idea and client are required" });
    const client = await requireMutableClient(c.get("auth"), parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m51.grok_creatives").catch(async () =>
      requireWritableCapability(client.workspaceId, "m51.brainstorm"),
    );
    const db = getDb();
    const ideas = await listGrokIdeas(client.workspaceId, client.id);
    const idea = ideas.find((row) => row.id === parsed.data.ideaId);
    const wantedPlatform =
      idea && typeof (idea.body.alternative as { targetPlatform?: string } | undefined)?.targetPlatform === "string"
        ? (idea.body.alternative as { targetPlatform?: "meta" | "google" }).targetPlatform
        : undefined;
    const accounts = await db.select().from(adAccounts).where(eq(adAccounts.clientId, client.id));
    const account =
      (parsed.data.adAccountId
        ? accounts.find((row) => row.id === parsed.data.adAccountId)
        : accounts.find((row) => !wantedPlatform || row.platform === wantedPlatform) ?? accounts[0]) ?? null;
    if (!account) throw new HTTPException(404, { message: "Connect an ad account first" });
    const campaign = await db.query.adEntities.findFirst({
      where: and(eq(adEntities.adAccountId, account.id), eq(adEntities.entityType, "campaign")),
    });
    if (!campaign) throw new HTTPException(404, { message: "Sync campaigns before promoting an ad" });
    const rec = await promoteGrokIdea({
      ideaId: parsed.data.ideaId,
      workspaceId: client.workspaceId,
      clientId: client.id,
      adAccountId: account.id,
      campaign: { entityType: campaign.entityType, externalId: campaign.externalId, name: campaign.name },
    });
    return c.json({
      recommendation: toRecommendationPublic(rec),
      writes: false,
      note: "Promoted to a suggestion. Approve is still required before any live create.",
    });
  });
}
