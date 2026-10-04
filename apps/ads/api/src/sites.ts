import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { canMutate, workspaceIdsFor, type AuthContext } from "@tharros/ads-shared";
import { getDb } from "@tharros/ads-shared/db";
import { clients } from "@tharros/ads-shared/schema";
import { requireMutableClient } from "./connect";
import { activateStore, assignClientSite } from "@tharros/ads-shared/entitlements";
import { writeAuditEvent } from "@tharros/ads-shared/audit";
import type { AppEnv } from "./types";

const siteIdSchema = z.string().trim().min(1).max(200);
const ensureSchema = z.object({ name: z.string().trim().min(1).max(200) });
const linkSchema = z.object({ siteId: siteIdSchema.nullable() });

export type SiteClient = {
  id: string;
  workspaceId: string;
  name: string;
  siteId: string | null;
  status: string;
  plan: string;
  pilotFlag: boolean;
  createdAt: string;
};

function toSiteClient(row: typeof clients.$inferSelect): SiteClient {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    siteId: row.siteId ?? null,
    status: row.status,
    plan: row.plan,
    pilotFlag: row.pilotFlag,
    createdAt: row.createdAt.toISOString(),
  };
}

function mutableWorkspaceId(auth: AuthContext): string {
  const workspaceId = workspaceIdsFor(auth).find((id) => canMutate(auth, id));
  if (!workspaceId) {
    throw new HTTPException(403, { message: "Owner or operator role required" });
  }
  return workspaceId;
}

async function uniqueClientName(workspaceId: string, base: string): Promise<string> {
  const db = getDb();
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base} (${n})`;
    const taken = await db.query.clients.findFirst({
      where: and(eq(clients.workspaceId, workspaceId), eq(clients.name, candidate)),
    });
    if (!taken) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/**
 * The ads client that owns a console site's ad accounts, created on first use.
 * An unlinked client with the same name (e.g. an existing pilot) is adopted instead of duplicated.
 */
export async function ensureSiteClient(auth: AuthContext, siteId: string, name: string) {
  const db = getDb();
  const workspaceId = mutableWorkspaceId(auth);

  const linked = await db.query.clients.findFirst({
    where: and(eq(clients.workspaceId, workspaceId), eq(clients.siteId, siteId)),
  });
  if (linked) return { client: linked, created: false, adopted: false };

  const sameName = await db.query.clients.findFirst({
    where: and(
      eq(clients.workspaceId, workspaceId),
      isNull(clients.siteId),
      sql`lower(${clients.name}) = lower(${name})`,
    ),
  });
  if (sameName) {
    const adopted = await assignClientSite(sameName.id, siteId);
    await writeAuditEvent({
      workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "client.site_linked",
      entityType: "client",
      entityId: adopted.id,
      payload: { siteId, adopted: true },
    });
    return { client: adopted, created: false, adopted: true };
  }

  const [created] = await db
    .insert(clients)
    .values({ workspaceId, name: await uniqueClientName(workspaceId, name), siteId, status: "active" })
    .onConflictDoNothing()
    .returning();
  const row =
    created ??
    (await db.query.clients.findFirst({
      where: and(eq(clients.workspaceId, workspaceId), eq(clients.siteId, siteId)),
    }));
  if (!row) throw new HTTPException(500, { message: "Could not create the ads client for this site" });
  if (created) {
    await activateStore(created.id, siteId);
    await writeAuditEvent({
      workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "client.created_for_site",
      entityType: "client",
      entityId: created.id,
      payload: { siteId },
    });
  }
  return { client: row, created: Boolean(created), adopted: false };
}

export function registerSiteRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.put("/sites/:siteId/client", requireAuth, async (c) => {
    const siteId = siteIdSchema.parse(c.req.param("siteId"));
    const parsed = ensureSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "name is required" });
    const result = await ensureSiteClient(c.get("auth"), siteId, parsed.data.name);
    return c.json({ client: toSiteClient(result.client), created: result.created, adopted: result.adopted });
  });

  app.post("/clients/:id/site", requireAuth, async (c) => {
    const parsed = linkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "siteId must be a string or null" });
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, c.req.param("id"));
    const db = getDb();
    if (parsed.data.siteId) {
      const other = await db.query.clients.findFirst({
        where: and(eq(clients.workspaceId, client.workspaceId), eq(clients.siteId, parsed.data.siteId)),
      });
      if (other && other.id !== client.id) {
        throw new HTTPException(409, { message: `That site is already linked to ${other.name}.` });
      }
    }
    const row = await assignClientSite(client.id, parsed.data.siteId);
    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: parsed.data.siteId ? "client.site_linked" : "client.site_unlinked",
      entityType: "client",
      entityId: client.id,
      payload: { siteId: parsed.data.siteId },
    });
    return c.json({ client: toSiteClient(row) });
  });
}
