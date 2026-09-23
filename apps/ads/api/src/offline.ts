import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isCapabilityVisible, isOfflineRecommendationType, type CapabilityFlags } from "@tharros/ads-shared";
import { summarizeAttribution, type AttributionCampaign } from "@tharros/ads-shared/attribution";
import { writeAuditEvent } from "@tharros/ads-shared/audit";
import {
  decryptCallRailApiKey,
  encryptCallRailApiKey,
  loadWorkspaceSettings,
  publicCallRailView,
  publicCrmView,
  saveWorkspaceConnectors,
} from "@tharros/ads-shared/connector-settings";
import { callRailConnector, housecallProConnector } from "@tharros/ads-shared/connectors";
import { getDb } from "@tharros/ads-shared/db";
import { adEntities } from "@tharros/ads-shared/schema";
import { loadWorkspaceCapabilities, requireWritableCapability } from "./capabilities";
import { requireMutableClient } from "./connect";
import { childLogger } from "./logger";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const connectCallRailSchema = z.object({
  clientId: z.string().uuid(),
  mock: z.boolean().optional(),
  useEnv: z.boolean().optional(),
  apiKey: z.string().min(4).max(200).optional(),
  accountId: z.string().min(1).max(80).optional(),
  companyId: z.string().min(1).max(80).optional(),
});

const clientIdSchema = z.object({
  clientId: z.string().uuid(),
});

async function campaignsForClient(clientId: string): Promise<AttributionCampaign[]> {
  const rows = await getDb().select().from(adEntities).where(eq(adEntities.clientId, clientId));
  return rows
    .filter((row) => row.entityType === "campaign")
    .map((row) => ({
      entityType: row.entityType,
      externalId: row.externalId,
      name: row.name,
      platform: row.platform,
    }));
}

export function filterOfflineRecommendations<T extends { type: string }>(
  rows: T[],
  flags: CapabilityFlags,
): T[] {
  return rows.filter((row) => {
    if (!isOfflineRecommendationType(row.type)) return true;
    if (row.type === "call_attribution") return isCapabilityVisible("m52.callrail_connect", flags);
    if (row.type === "crm_booked_job") return isCapabilityVisible("m52.crm_join", flags);
    return true;
  });
}

export function registerOfflineRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/offline-attribution", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    const callrailOn = isCapabilityVisible("m52.callrail_connect", flags);
    const crmOn = isCapabilityVisible("m52.crm_join", flags);
    if (!callrailOn && !crmOn) {
      return c.json({
        visible: false,
        callrail: { connected: false, mock: false, callCount: 0 },
        crm: { connected: false, mock: false, bookedJobCount: 0 },
        sentences: [],
        joins: [],
        writes: false,
      });
    }
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    const callrail = connectors.callrail[client.id];
    const crm = connectors.crm[client.id];
    const campaigns = await campaignsForClient(client.id);
    const summary = summarizeAttribution({
      calls: callrailOn ? (callrail?.snapshot?.calls ?? []) : [],
      campaigns,
      bookedJobs: crmOn ? (crm?.bookedJobs ?? []) : [],
      crmEnabled: crmOn && Boolean(crm?.connected),
    });
    return c.json({
      visible: true,
      callrail: publicCallRailView(callrail),
      crm: publicCrmView(crm),
      sentences: summary.sentences,
      joins: summary.joins,
      writes: false,
    });
  });

  app.post("/connectors/callrail/connect", requireAuth, async (c) => {
    const parsed = connectCallRailSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required. Add mock, useEnv, or apiKey + accountId." });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.callrail_connect");
    const connected = await callRailConnector.connect({
      workspaceId: client.workspaceId,
      clientId: client.id,
      mock: parsed.data.mock,
      useEnv: parsed.data.useEnv,
      apiKey: parsed.data.apiKey,
      accountId: parsed.data.accountId,
      companyId: parsed.data.companyId,
    });
    if (!connected.ok) {
      throw new HTTPException(409, { message: connected.reason ?? "CallRail connect failed." });
    }
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    connectors.callrail[client.id] = {
      connected: true,
      mock: Boolean(connected.mock),
      accountId: connected.externalId ?? parsed.data.accountId ?? null,
      companyId: parsed.data.companyId ?? null,
      encryptedApiKey: parsed.data.apiKey ? encryptCallRailApiKey(parsed.data.apiKey) : null,
      usesEnv: Boolean(parsed.data.useEnv) && !parsed.data.mock,
      lastPulledAt: null,
      lastError: null,
    };
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "callrail_connect",
      entityType: "client",
      entityId: client.id,
      payload: { mock: Boolean(connected.mock), usesEnv: Boolean(parsed.data.useEnv), writes: false },
    });
    childLogger(c.get("requestId")).info({
      msg: "callrail.connect",
      clientId: client.id,
      mock: Boolean(connected.mock),
    });
    return c.json({
      ok: true,
      callrail: publicCallRailView(connectors.callrail[client.id]),
      reason: connected.reason,
      writes: false,
    });
  });

  app.post("/connectors/callrail/disconnect", requireAuth, async (c) => {
    const parsed = clientIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.callrail_connect");
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    delete connectors.callrail[client.id];
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await callRailConnector.disconnect({ workspaceId: client.workspaceId, clientId: client.id });
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "callrail_disconnect",
      entityType: "client",
      entityId: client.id,
      payload: { writes: false },
    });
    return c.json({ ok: true, callrail: publicCallRailView(undefined), writes: false });
  });

  app.post("/connectors/callrail/pull", requireAuth, async (c) => {
    const parsed = clientIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.callrail_connect");
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    const current = connectors.callrail[client.id];
    if (!current?.connected) {
      throw new HTTPException(409, { message: "Connect CallRail before pulling calls." });
    }
    const pulled = await callRailConnector.pullCalls({
      workspaceId: client.workspaceId,
      clientId: client.id,
      clientName: client.name,
      mock: current.mock,
      accountId: current.accountId ?? undefined,
      apiKey: decryptCallRailApiKey(current.encryptedApiKey) ?? undefined,
    });
    if (!pulled.ok) {
      current.lastError = pulled.reason ?? "CallRail pull failed.";
      connectors.callrail[client.id] = current;
      await saveWorkspaceConnectors(client.workspaceId, connectors);
      throw new HTTPException(409, { message: current.lastError });
    }
    current.lastError = null;
    current.lastPulledAt = new Date().toISOString();
    current.snapshot = {
      pulledAt: current.lastPulledAt,
      mock: pulled.mock,
      calls: pulled.calls,
    };
    connectors.callrail[client.id] = current;
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "callrail_pull",
      entityType: "client",
      entityId: client.id,
      payload: { mock: pulled.mock, callCount: pulled.calls.length, writes: false },
    });
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    const crmOn = isCapabilityVisible("m52.crm_join", flags);
    const crm = connectors.crm[client.id];
    const summary = summarizeAttribution({
      calls: pulled.calls,
      campaigns: await campaignsForClient(client.id),
      bookedJobs: crmOn ? (crm?.bookedJobs ?? []) : [],
      crmEnabled: crmOn && Boolean(crm?.connected),
    });
    return c.json({
      ok: true,
      callrail: publicCallRailView(current),
      sentences: summary.sentences,
      joins: summary.joins,
      writes: false,
    });
  });

  app.post("/connectors/crm/connect", requireAuth, async (c) => {
    const parsed = clientIdSchema.extend({ mock: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.crm_join");
    const joined = await housecallProConnector.listBookedJobs({
      workspaceId: client.workspaceId,
      clientId: client.id,
      clientName: client.name,
      mock: true,
    });
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    connectors.crm[client.id] = {
      connected: true,
      mock: true,
      provider: "hcp",
      lastError: null,
      bookedJobs: joined.bookedJobs,
    };
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "crm_connect",
      entityType: "client",
      entityId: client.id,
      payload: { provider: "hcp", mock: true, writes: false },
    });
    return c.json({
      ok: true,
      crm: publicCrmView(connectors.crm[client.id]),
      writes: false,
      reason: joined.reason,
    });
  });

  app.post("/connectors/crm/disconnect", requireAuth, async (c) => {
    const parsed = clientIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.crm_join");
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    delete connectors.crm[client.id];
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    return c.json({ ok: true, crm: publicCrmView(undefined), writes: false });
  });
}
