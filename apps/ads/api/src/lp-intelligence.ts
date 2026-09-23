import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { isCapabilityVisible, isLpIntelligenceVisible } from "@tharros/ads-shared";
import { writeAuditEvent } from "@tharros/ads-shared/audit";
import {
  decryptClarityApiKey,
  encryptClarityApiKey,
  loadWorkspaceSettings,
  publicClarityView,
  saveWorkspaceConnectors,
} from "@tharros/ads-shared/connector-settings";
import { clarityAnalyticsConnector, getDefaultSiteConnector } from "@tharros/ads-shared/connectors";
import { siteApplyMode } from "@tharros/ads-shared/lp-intelligence";
import { loadWorkspaceCapabilities, requireWritableCapability } from "./capabilities";
import { requireMutableClient } from "./connect";
import { childLogger } from "./logger";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const connectClaritySchema = z.object({
  clientId: z.string().uuid(),
  mock: z.boolean().optional(),
  useEnv: z.boolean().optional(),
  apiKey: z.string().min(4).max(200).optional(),
  projectId: z.string().min(1).max(80).optional(),
});

const clientIdSchema = z.object({
  clientId: z.string().uuid(),
});

export function registerLpIntelligenceRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/lp-intelligence", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    const clarityOn = isCapabilityVisible("m52.clarity_connect", flags);
    const lpOn = isLpIntelligenceVisible(flags);
    const site = getDefaultSiteConnector();
    if (!clarityOn && !lpOn) {
      return c.json({
        visible: false,
        clarity: publicClarityView(undefined),
        recKinds: [],
        siteApply: "later",
        siteSupportsMutation: false,
        capture: false,
        writes: false,
      });
    }
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    const clarity = connectors.clarity[client.id];
    return c.json({
      visible: true,
      clarity: publicClarityView(clarity),
      recKinds: ["hero", "structure", "copy", "wizard"],
      siteApply: siteApplyMode(site),
      siteSupportsMutation: site.supportsLandingPageMutation,
      capture: false,
      writes: false,
    });
  });

  app.post("/connectors/clarity/connect", requireAuth, async (c) => {
    const parsed = connectClaritySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required. Add mock, useEnv, or apiKey + projectId." });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.clarity_connect");
    const connected = await clarityAnalyticsConnector.connect({
      workspaceId: client.workspaceId,
      clientId: client.id,
      mock: parsed.data.mock,
      useEnv: parsed.data.useEnv,
      apiKey: parsed.data.apiKey,
      projectId: parsed.data.projectId,
    });
    if (!connected.ok) {
      throw new HTTPException(409, { message: connected.reason ?? "Clarity connect failed." });
    }
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    connectors.clarity[client.id] = {
      connected: true,
      mock: Boolean(connected.mock),
      projectId: connected.externalId ?? parsed.data.projectId ?? null,
      encryptedApiKey: parsed.data.apiKey ? encryptClarityApiKey(parsed.data.apiKey) : null,
      usesEnv: Boolean(parsed.data.useEnv) && !parsed.data.mock,
      lastPulledAt: null,
      lastError: null,
    };
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "clarity_connect",
      entityType: "client",
      entityId: client.id,
      payload: { mock: Boolean(connected.mock), usesEnv: Boolean(parsed.data.useEnv), writes: false, capture: false },
    });
    childLogger(c.get("requestId")).info({
      msg: "clarity.connect",
      clientId: client.id,
      mock: Boolean(connected.mock),
    });
    return c.json({
      ok: true,
      clarity: publicClarityView(connectors.clarity[client.id]),
      reason: connected.reason,
      writes: false,
      capture: false,
    });
  });

  app.post("/connectors/clarity/disconnect", requireAuth, async (c) => {
    const parsed = clientIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.clarity_connect");
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    delete connectors.clarity[client.id];
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await clarityAnalyticsConnector.disconnect({ workspaceId: client.workspaceId, clientId: client.id });
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "clarity_disconnect",
      entityType: "client",
      entityId: client.id,
      payload: { writes: false, capture: false },
    });
    return c.json({ ok: true, clarity: publicClarityView(undefined), writes: false, capture: false });
  });

  app.post("/connectors/clarity/pull", requireAuth, async (c) => {
    const parsed = clientIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    await requireWritableCapability(client.workspaceId, "m52.clarity_connect");
    const { connectors } = await loadWorkspaceSettings(client.workspaceId);
    const current = connectors.clarity[client.id];
    if (!current?.connected) {
      throw new HTTPException(409, { message: "Connect Clarity before pulling session signals." });
    }
    const pulled = await clarityAnalyticsConnector.pullSessionSignals({
      workspaceId: client.workspaceId,
      clientId: client.id,
      clientName: client.name,
      mock: current.mock,
      projectId: current.projectId ?? undefined,
      apiKey: decryptClarityApiKey(current.encryptedApiKey) ?? undefined,
    });
    if (!pulled.ok) {
      current.lastError = pulled.reason ?? "Clarity pull failed.";
      connectors.clarity[client.id] = current;
      await saveWorkspaceConnectors(client.workspaceId, connectors);
      throw new HTTPException(409, { message: current.lastError });
    }
    current.lastError = null;
    current.lastPulledAt = new Date().toISOString();
    current.snapshot = {
      pulledAt: current.lastPulledAt,
      mock: pulled.mock,
      projectId: current.projectId,
      sessionCount: pulled.sessionCount,
      signals: pulled.signals,
      capture: false,
      writes: false,
    };
    connectors.clarity[client.id] = current;
    await saveWorkspaceConnectors(client.workspaceId, connectors);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "clarity_pull",
      entityType: "client",
      entityId: client.id,
      payload: {
        mock: pulled.mock,
        signalCount: pulled.signals.length,
        sessionCount: pulled.sessionCount,
        writes: false,
        capture: false,
      },
    });
    return c.json({
      ok: true,
      clarity: publicClarityView(current),
      reason: pulled.reason,
      writes: false,
      capture: false,
      siteApply: siteApplyMode(getDefaultSiteConnector()),
    });
  });
}
