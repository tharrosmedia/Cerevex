import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolveAuditActor } from "@tharros/ads-shared/actor";
import { getDb } from "@tharros/ads-shared/db";
import { auditLog, workspaces } from "@tharros/ads-shared/schema";
import { isServicePrincipal } from "./auth";
import type { AppEnv } from "./types";

/** Workspace flag. Only boolean false releases the connector. Absent stays tripped. */
export const MCP_CONNECTOR_KILL_SWITCH_KEY = "mcpConnectorKillSwitch";

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
    reason: z.enum(["origin", "method", "protocol", "headers", "kill_switch", "unauthenticated", "call"]),
    identityId: z.string().uuid().nullable(),
    identityName: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable(),
    authType: z.enum(["unauthenticated", "agent"]),
  })
  .strict();

export function connectorKillSwitchTripped(settingsJson: unknown): boolean {
  if (settingsJson === null || typeof settingsJson !== "object" || Array.isArray(settingsJson)) return true;
  return (settingsJson as Record<string, unknown>)[MCP_CONNECTOR_KILL_SWITCH_KEY] !== false;
}

function assertService(c: { get: (key: "auth") => AppEnv["Variables"]["auth"] }) {
  const auth = c.get("auth");
  if (!isServicePrincipal(auth)) {
    throw new HTTPException(403, { message: "Service key required" });
  }
  const workspaceId = auth.memberships[0]?.workspaceId;
  if (!workspaceId) {
    throw new HTTPException(401, { message: "Service workspace is not configured" });
  }
  return workspaceId;
}

/**
 * Service-principal façade for cerevex-mcp. User sessions cannot read the
 * switch or append the workspace security log. The body is an allowlist;
 * tool arguments and tokens are not fields on it.
 */
export function registerMcpConnectorRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/internal/mcp/connector", requireAuth, async (c) => {
    const workspaceId = assertService(c);
    const workspace = await getDb().query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    if (!workspace) {
      throw new HTTPException(401, { message: "Service workspace is not configured" });
    }
    return c.json({ killSwitch: connectorKillSwitchTripped(workspace.settingsJson) });
  });

  app.post("/internal/mcp/security-audit", requireAuth, async (c) => {
    const workspaceId = assertService(c);
    const raw = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HTTPException(400, { message: "Invalid audit entry" });
    }
    const keys = Object.keys(raw);
    if (keys.length !== AUDIT_KEYS.length || AUDIT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))) {
      throw new HTTPException(400, { message: "Invalid audit entry" });
    }
    const parsed = securityAuditSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HTTPException(400, { message: "Invalid audit entry" });
    }
    const actor = resolveAuditActor("service", null);
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
}
