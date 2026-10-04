import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { writeAuditEvent } from "@tharros/ads-shared/audit";
import { activateStore, deactivateStore, getEntitlements } from "@tharros/ads-shared/entitlements";
import { auditActor } from "./auth";
import { requireMutableClient } from "./connect";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const storeSchema = z.object({
  storeId: z.string().trim().min(1).max(200),
});

export function registerEntitlementRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/entitlements", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) throw new HTTPException(404, { message: "Client not found" });
    return c.json({ entitlements: await getEntitlements(client.id) });
  });

  app.post("/clients/:id/locations", requireAuth, async (c) => {
    const parsed = storeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "storeId is required" });
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, c.req.param("id"));
    const location = await activateStore(client.id, parsed.data.storeId);
    const actor = auditActor(auth);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "location.activated",
      entityType: "location",
      entityId: location.id,
      payload: { storeId: location.storeId, clientId: client.id },
    });
    return c.json({
      location: {
        id: location.id,
        clientId: location.clientId,
        storeId: location.storeId,
        status: location.status,
      },
    });
  });

  app.post("/clients/:id/locations/deactivate", requireAuth, async (c) => {
    const parsed = storeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "storeId is required" });
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, c.req.param("id"));
    const location = await deactivateStore(client.id, parsed.data.storeId);
    if (!location) throw new HTTPException(404, { message: "That location isn't on this account." });
    const actor = auditActor(auth);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "location.deactivated",
      entityType: "location",
      entityId: location.id,
      payload: { storeId: location.storeId, clientId: client.id },
    });
    return c.json({
      location: {
        id: location.id,
        clientId: location.clientId,
        storeId: location.storeId,
        status: location.status,
      },
    });
  });
}
