import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  MCP_READ_MAX_LIMIT,
  MCP_READ_TOOLS,
  isMcpScope,
  mcpInclusiveDays,
  mcpReadCursor,
  mcpReadLogEvent,
  type McpScope,
} from "@cerevex/contracts";
import { getDb } from "@tharros/ads-shared/db";
import { clients, mcpIdentities, mcpIdentityGrants, workspaces } from "@tharros/ads-shared/schema";
import { connectorEffectivelyOff, connectorEnvValue } from "./mcp-connector";
import { fetchBrainMcpRead } from "./mcp-brain-client";
import { logger } from "./logger";
import type { AppEnv } from "./types";

const CURSOR = /^[A-Za-z0-9_-]{1,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const readSchema = z
  .object({
    tool: z.enum(MCP_READ_TOOLS),
    identityId: z.string().uuid(),
    clientId: z.string().uuid(),
    limit: z.number().int().min(1).max(MCP_READ_MAX_LIMIT),
    cursor: z.string().regex(CURSOR).nullable(),
    dateStart: z.string().regex(DAY).optional(),
    dateEnd: z.string().regex(DAY).optional(),
    view: z.enum(["queries", "pages", "both"]).optional(),
    status: z.enum(["open", "all"]).optional(),
  })
  .strict();

type ReadBody = z.infer<typeof readSchema>;

function readScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: McpScope[] = [];
  for (const item of value) {
    if (typeof item === "string" && isMcpScope(item) && !scopes.includes(item)) scopes.push(item);
  }
  return scopes;
}

function argumentsMatch(body: ReadBody): boolean {
  const cursor = mcpReadCursor(body.tool, body.cursor);
  if (!cursor) return false;
  if (body.tool === "get_gsc_performance" && body.cursor && cursor.tool === "get_gsc_performance") {
    if (body.view === "queries" && cursor.side !== "queries") return false;
    if (body.view === "pages" && cursor.side !== "pages") return false;
  }
  if (body.tool === "get_gsc_performance") {
    if (!body.dateStart || !body.dateEnd || !body.view || body.status) return false;
    return mcpInclusiveDays(body.dateStart, body.dateEnd) != null;
  }
  if (body.tool === "get_seo_findings") {
    return Boolean(body.status) && !body.dateStart && !body.dateEnd && !body.view;
  }
  return !body.dateStart && !body.dateEnd && !body.view && !body.status;
}

/**
 * cerevex-mcp principal only. A missing grant and a missing client are the same 404.
 * Shape is checked before the grant so a bad limit is not a tenant oracle.
 * Rows come from Brain's read-only route. This handler does not copy them into os.
 */
export function registerMcpReadRoute(
  app: Hono<AppEnv>,
  assertWorkspace: (header: string | undefined) => Promise<string>,
) {
  app.post("/internal/mcp/read", async (c) => {
    const workspaceId = await assertWorkspace(c.req.header("x-cerevex-mcp-key"));
    const parsed = readSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !argumentsMatch(parsed.data)) return c.json({ ok: false }, 400);

    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!workspace || connectorEffectivelyOff(workspace.settingsJson, connectorEnvValue())) {
      return c.json({ ok: false, error: "kill_switch" }, 403);
    }
    const [identity] = await db
      .select({ scopes: mcpIdentities.scopes })
      .from(mcpIdentities)
      .where(
        and(
          eq(mcpIdentities.id, parsed.data.identityId),
          eq(mcpIdentities.workspaceId, workspaceId),
          isNull(mcpIdentities.revokedAt),
        ),
      )
      .limit(1);
    // Missing, revoked, and ungranted all look the same. Scope is about the token.
    if (!identity) return c.json({ ok: false }, 404);
    if (!readScopes(identity.scopes).includes("cerevex.read")) {
      return c.json({ ok: false, error: "insufficient_scope" }, 403);
    }

    const [row] = await db
      .select({ clientId: clients.id })
      .from(mcpIdentityGrants)
      .innerJoin(clients, eq(mcpIdentityGrants.clientId, clients.id))
      .where(
        and(
          eq(mcpIdentityGrants.identityId, parsed.data.identityId),
          eq(clients.id, parsed.data.clientId),
          eq(clients.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ ok: false }, 404);
    const remote = await fetchBrainMcpRead(parsed.data);
    const rows = remote.ok ? remote.read.returned : 0;
    logger.info(mcpReadLogEvent({
      identityId: parsed.data.identityId,
      clientId: parsed.data.clientId,
      tool: parsed.data.tool,
      rows,
    }));
    if (!remote.ok) return c.json({ ok: false }, remote.status);
    return c.json({ ok: true, read: remote.read });
  });
}
