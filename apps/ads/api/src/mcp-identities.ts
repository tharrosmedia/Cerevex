import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  allocateMcpIdentitySlug,
  isMcpScope,
  MCP_DISPLAY_NAME_MESSAGE,
  MCP_SCOPES,
  parseMcpDisplayName,
  type McpScope,
} from "@cerevex/contracts";
import { resolveAuditActor } from "@tharros/ads-shared/actor";
import { getDb } from "@tharros/ads-shared/db";
import { auditLog, clients, mcpIdentities, mcpIdentityGrants, workspaces } from "@tharros/ads-shared/schema";
import type { AuthContext } from "@tharros/ads-shared";
import { isServicePrincipal, internalWorkspaceId } from "./auth";
import { MCP_CONNECTOR_KILL_SWITCH_KEY, connectorOwnerView, connectorServiceView } from "./mcp-connector";
import { registerMcpReadRoute } from "./mcp-reads";
import { registerMcpSubmitRoute } from "./mcp-submit";
import { mcpKeyMatches } from "./mcp-principal";
import { createMcpToken, MCP_TOKEN_HASH_HEX } from "./mcp-token";
import type { AppEnv } from "./types";

const OWNER_ONLY = "Only a workspace owner can manage the connector.";

const createSchema = z
  .object({
    displayName: z.string(),
    scopes: z.array(z.enum(MCP_SCOPES)).min(1).max(MCP_SCOPES.length),
    clientIds: z.array(z.string().uuid()).max(64).default([]),
  })
  .strict();

const SLUG_UNIQUE = "mcp_identities_workspace_name_idx";

const grantSchema = z
  .object({
    clientIds: z.array(z.string().uuid()).max(64),
  })
  .strict();

const killSwitchSchema = z.object({ killSwitch: z.boolean() }).strict();

const verifySchema = z.object({ tokenHash: z.string().regex(MCP_TOKEN_HASH_HEX) }).strict();

const AUDIT_KEYS = [
  "requestId",
  "result",
  "httpStatus",
  "protocolVersion",
  "method",
  "tool",
  "clientName",
  "clientVersion",
  "latencyMs",
  "reason",
  "identityId",
  "identityName",
  "authType",
  "count",
] as const;

const securityAuditSchema = z
  .object({
    requestId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    result: z.enum(["ok", "created", "merged", "duplicate", "rejected", "denied", "rate_limited", "error"]),
    httpStatus: z.number().int().min(100).max(599),
    protocolVersion: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
    method: z.string().regex(/^[a-z][a-z0-9/_-]{0,79}$/).nullable(),
    tool: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/).nullable(),
    clientName: z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/).nullable(),
    clientVersion: z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/).nullable(),
    latencyMs: z.number().int().min(0).max(600_000),
    reason: z.enum([
      "origin",
      "method",
      "protocol",
      "headers",
      "kill_switch",
      "unauthenticated",
      "insufficient_scope",
      "not_granted",
      "rate_limited",
      "call",
    ]),
    identityId: z.string().uuid().nullable(),
    identityName: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable(),
    authType: z.enum(["unauthenticated", "agent"]),
    count: z.number().int().min(1).max(100_000),
  })
  .strict();

export type McpIdentityPublic = {
  id: string;
  /** Immutable slug. Token verify and security logs use this, not the display name. */
  name: string;
  displayName: string;
  scopes: McpScope[];
  clientIds: string[];
  revokedAt: string | null;
  createdAt: string;
};

type IdentityRow = {
  id: string;
  name: string;
  displayName: string;
  scopes: unknown;
  revokedAt: Date | null;
  createdAt: Date;
};

const identityColumns = {
  id: mcpIdentities.id,
  name: mcpIdentities.name,
  displayName: mcpIdentities.displayName,
  scopes: mcpIdentities.scopes,
  revokedAt: mcpIdentities.revokedAt,
  createdAt: mcpIdentities.createdAt,
};

export function requireOwnerWorkspace(auth: AuthContext): { workspaceId: string; userId: string } {
  if (isServicePrincipal(auth) || !auth.user) {
    throw new HTTPException(403, { message: OWNER_ONLY });
  }
  const owners = auth.memberships.filter((row) => row.role === "owner").map((row) => row.workspaceId);
  if (owners.length !== 1 || !auth.user.id) {
    throw new HTTPException(403, { message: OWNER_ONLY });
  }
  return { workspaceId: owners[0]!, userId: auth.user.id };
}

async function assertMcpWorkspace(header: string | undefined): Promise<string> {
  if (!mcpKeyMatches(header)) {
    throw new HTTPException(401, { message: "MCP service key required" });
  }
  const workspaceId = internalWorkspaceId();
  if (!workspaceId) {
    throw new HTTPException(401, { message: "Service workspace is not configured" });
  }
  const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!workspace) {
    throw new HTTPException(401, { message: "Service workspace is not configured" });
  }
  return workspaceId;
}

function readScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: McpScope[] = [];
  for (const item of value) {
    if (typeof item === "string" && isMcpScope(item) && !scopes.includes(item)) scopes.push(item);
  }
  return scopes;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

function uniqueViolation(error: unknown): { constraint: string | null } | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let constraint: string | null = null;
  let unique = false;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (record.code === "23505") unique = true;
    if (typeof record.constraint === "string" && record.constraint.length > 0) constraint = record.constraint;
    current = record.cause;
  }
  return unique ? { constraint } : null;
}

async function grantsFor(identityIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (identityIds.length === 0) return grouped;
  const rows = await getDb()
    .select({ identityId: mcpIdentityGrants.identityId, clientId: mcpIdentityGrants.clientId })
    .from(mcpIdentityGrants)
    .where(inArray(mcpIdentityGrants.identityId, identityIds));
  for (const row of rows) {
    const list = grouped.get(row.identityId) ?? [];
    list.push(row.clientId);
    grouped.set(row.identityId, list);
  }
  for (const [id, list] of grouped) grouped.set(id, uniqueIds(list));
  return grouped;
}

function toPublic(row: IdentityRow, clientIds: string[]): McpIdentityPublic {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    scopes: readScopes(row.scopes),
    clientIds,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function clientsInWorkspace(workspaceId: string, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const rows = await getDb()
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), inArray(clients.id, clientIds)));
  if (rows.length !== clientIds.length) {
    throw new HTTPException(400, { message: "Client not found" });
  }
}

async function insertOwnerAudit(
  tx: { insert: ReturnType<typeof getDb>["insert"] },
  input: {
    workspaceId: string;
    userId: string;
    action: string;
    entityId: string | null;
    payload: Record<string, unknown>;
  },
) {
  const actor = resolveAuditActor("user", input.userId);
  await tx.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: input.action,
    entityType: input.entityId ? "mcp_identity" : "mcp_connector",
    entityId: input.entityId,
    payloadJson: input.payload,
  });
}

function settingsWithKillSwitch(settings: unknown, tripped: boolean): Record<string, unknown> {
  const base =
    settings !== null && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) }
      : {};
  base[MCP_CONNECTOR_KILL_SWITCH_KEY] = tripped;
  return base;
}

async function insertIdentity(input: {
  workspaceId: string;
  userId: string;
  displayName: string;
  scopes: McpScope[];
  clientIds: string[];
  tokenHash: string;
}): Promise<IdentityRow> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getDb().transaction(async (tx) => {
        const existing = await tx
          .select({ name: mcpIdentities.name })
          .from(mcpIdentities)
          .where(eq(mcpIdentities.workspaceId, input.workspaceId));
        const slug = allocateMcpIdentitySlug(input.displayName, new Set(existing.map((row) => row.name)));
        if (!slug) throw new HTTPException(500, { message: "Identity was not created" });
        const [row] = await tx
          .insert(mcpIdentities)
          .values({
            workspaceId: input.workspaceId,
            name: slug,
            displayName: input.displayName,
            tokenHash: input.tokenHash,
            scopes: input.scopes,
            createdBy: input.userId,
          })
          .returning(identityColumns);
        if (!row) throw new HTTPException(500, { message: "Identity was not created" });
        if (input.clientIds.length > 0) {
          await tx
            .insert(mcpIdentityGrants)
            .values(input.clientIds.map((clientId) => ({ identityId: row.id, clientId })));
        }
        await insertOwnerAudit(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          action: "mcp.identity.create",
          entityId: row.id,
          payload: { name: row.name, displayName: row.displayName, scopes: input.scopes, clientIds: input.clientIds },
        });
        return row;
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      const violation = uniqueViolation(error);
      if (violation?.constraint === SLUG_UNIQUE && attempt === 0) continue;
      throw error;
    }
  }
  throw new HTTPException(500, { message: "Identity was not created" });
}

/**
 * Owner routes for identities and the connector kill switch.
 * The MCP service key cannot call these. The Brain service key cannot call these.
 */
export function registerMcpIdentityRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/mcp/identities", requireAuth, async (c) => {
    const { workspaceId } = requireOwnerWorkspace(c.get("auth"));
    const rows = await getDb()
      .select(identityColumns)
      .from(mcpIdentities)
      .where(eq(mcpIdentities.workspaceId, workspaceId))
      .orderBy(desc(mcpIdentities.createdAt));
    const grants = await grantsFor(rows.map((row) => row.id));
    return c.json({
      identities: rows.map((row) => toPublic(row, grants.get(row.id) ?? [])),
    });
  });

  app.post("/mcp/identities", requireAuth, async (c) => {
    const { workspaceId, userId } = requireOwnerWorkspace(c.get("auth"));
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "Name, scopes, and client ids are required" });
    }
    const displayName = parseMcpDisplayName(parsed.data.displayName);
    if (!displayName) throw new HTTPException(400, { message: MCP_DISPLAY_NAME_MESSAGE });
    const clientIds = uniqueIds(parsed.data.clientIds);
    const scopes = uniqueIds(parsed.data.scopes).filter(isMcpScope);
    if (scopes.length === 0) {
      throw new HTTPException(400, { message: "Name, scopes, and client ids are required" });
    }
    await clientsInWorkspace(workspaceId, clientIds);
    const issued = createMcpToken();
    let created: IdentityRow;
    try {
      created = await insertIdentity({
        workspaceId,
        userId,
        displayName,
        scopes,
        clientIds,
        tokenHash: issued.tokenHash,
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (uniqueViolation(error)) {
        throw new HTTPException(409, { message: "Identity name is already in use" });
      }
      throw error;
    }
    return c.json({ identity: toPublic(created, clientIds), token: issued.token });
  });

  app.post("/mcp/identities/:id/revoke", requireAuth, async (c) => {
    const { workspaceId, userId } = requireOwnerWorkspace(c.get("auth"));
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      throw new HTTPException(404, { message: "Identity not found" });
    }
    const revokedAt = new Date();
    const row = await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select(identityColumns)
        .from(mcpIdentities)
        .where(and(eq(mcpIdentities.id, id), eq(mcpIdentities.workspaceId, workspaceId)))
        .for("update");
      if (!current) return null;
      if (current.revokedAt) return current;
      const [updated] = await tx
        .update(mcpIdentities)
        .set({ revokedAt })
        .where(eq(mcpIdentities.id, id))
        .returning(identityColumns);
      if (!updated) return null;
      await insertOwnerAudit(tx, {
        workspaceId,
        userId,
        action: "mcp.identity.revoke",
        entityId: updated.id,
        payload: { name: updated.name, displayName: updated.displayName },
      });
      return updated;
    });
    if (!row) throw new HTTPException(404, { message: "Identity not found" });
    const grants = await grantsFor([row.id]);
    return c.json({ identity: toPublic(row, grants.get(row.id) ?? []) });
  });

  app.put("/mcp/identities/:id/grants", requireAuth, async (c) => {
    const { workspaceId, userId } = requireOwnerWorkspace(c.get("auth"));
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      throw new HTTPException(404, { message: "Identity not found" });
    }
    const parsed = grantSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "Client ids are required" });
    const clientIds = uniqueIds(parsed.data.clientIds);
    await clientsInWorkspace(workspaceId, clientIds);
    const row = await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select(identityColumns)
        .from(mcpIdentities)
        .where(and(eq(mcpIdentities.id, id), eq(mcpIdentities.workspaceId, workspaceId)))
        .for("update");
      if (!current) return null;
      if (current.revokedAt) {
        throw new HTTPException(409, { message: "Identity is revoked" });
      }
      await tx.delete(mcpIdentityGrants).where(eq(mcpIdentityGrants.identityId, id));
      if (clientIds.length > 0) {
        await tx.insert(mcpIdentityGrants).values(clientIds.map((clientId) => ({ identityId: id, clientId })));
      }
      await insertOwnerAudit(tx, {
        workspaceId,
        userId,
        action: "mcp.identity.grant",
        entityId: current.id,
        payload: { name: current.name, displayName: current.displayName, clientIds },
      });
      return current;
    });
    if (!row) throw new HTTPException(404, { message: "Identity not found" });
    return c.json({ identity: toPublic(row, clientIds) });
  });

  app.get("/mcp/connector", requireAuth, async (c) => {
    const { workspaceId } = requireOwnerWorkspace(c.get("auth"));
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    return c.json(connectorOwnerView(workspace.settingsJson));
  });

  app.put("/mcp/connector", requireAuth, async (c) => {
    const { workspaceId, userId } = requireOwnerWorkspace(c.get("auth"));
    const parsed = killSwitchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "killSwitch boolean is required" });
    const tripped = parsed.data.killSwitch;
    await getDb().transaction(async (tx) => {
      const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).for("update");
      if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
      await tx
        .update(workspaces)
        .set({ settingsJson: settingsWithKillSwitch(workspace.settingsJson, tripped) })
        .where(eq(workspaces.id, workspaceId));
      await insertOwnerAudit(tx, {
        workspaceId,
        userId,
        action: "mcp.connector.kill_switch",
        entityId: null,
        payload: { killSwitch: tripped },
      });
    });
    return c.json(connectorOwnerView({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: tripped }));
  });
}

/**
 * cerevex-mcp principal only. The Brain service key and user sessions are refused.
 * Verify looks up the hash and ignores revoked rows, so revoke applies on the next call.
 */
export function registerMcpServiceRoutes(app: Hono<AppEnv>) {
  app.get("/internal/mcp/connector", async (c) => {
    const workspaceId = await assertMcpWorkspace(c.req.header("x-cerevex-mcp-key"));
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!workspace) throw new HTTPException(401, { message: "Service workspace is not configured" });
    return c.json(connectorServiceView(workspace.settingsJson));
  });

  app.post("/internal/mcp/security-audit", async (c) => {
    const workspaceId = await assertMcpWorkspace(c.req.header("x-cerevex-mcp-key"));
    const raw = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HTTPException(400, { message: "Invalid audit entry" });
    }
    const keys = Object.keys(raw);
    if (keys.length !== AUDIT_KEYS.length || AUDIT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))) {
      throw new HTTPException(400, { message: "Invalid audit entry" });
    }
    const parsed = securityAuditSchema.safeParse(raw);
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid audit entry" });
    const actor = resolveAuditActor("mcp", null);
    await getDb().insert(auditLog).values({
      workspaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "mcp.call",
      entityType: "mcp_request",
      payloadJson: parsed.data,
    });
    return c.json({ ok: true });
  });

  app.post("/internal/mcp/verify", async (c) => {
    const workspaceId = await assertMcpWorkspace(c.req.header("x-cerevex-mcp-key"));
    const parsed = verifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid token" });
    const [row] = await getDb()
      .select({
        id: mcpIdentities.id,
        name: mcpIdentities.name,
        scopes: mcpIdentities.scopes,
      })
      .from(mcpIdentities)
      .where(
        and(
          eq(mcpIdentities.workspaceId, workspaceId),
          eq(mcpIdentities.tokenHash, parsed.data.tokenHash),
          isNull(mcpIdentities.revokedAt),
        ),
      )
      .limit(1);
    const scopes = row ? readScopes(row.scopes) : [];
    if (!row || scopes.length === 0) return c.json({ ok: false });
    return c.json({ ok: true, identity: { id: row.id, name: row.name, scopes } });
  });

  registerMcpReadRoute(app, assertMcpWorkspace);
  registerMcpSubmitRoute(app, assertMcpWorkspace);
}
