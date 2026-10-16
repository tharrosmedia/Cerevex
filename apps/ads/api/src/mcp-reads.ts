import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  MCP_READ_MAX_LIMIT,
  MCP_READ_TOOLS,
  isMcpScope,
  mcpInclusiveDays,
  type McpReadTool,
  type McpScope,
} from "@cerevex/contracts";
import { getDb } from "@tharros/ads-shared/db";
import { clients, mcpIdentities, mcpIdentityGrants } from "@tharros/ads-shared/schema";
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
  if (body.tool === "get_gsc_performance") {
    if (!body.dateStart || !body.dateEnd || !body.view || body.status) return false;
    return mcpInclusiveDays(body.dateStart, body.dateEnd) != null;
  }
  if (body.tool === "get_seo_findings") {
    return Boolean(body.status) && !body.dateStart && !body.dateEnd && !body.view;
  }
  return !body.dateStart && !body.dateEnd && !body.view && !body.status;
}

function publicStoreId(value: string | null): string | null {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return null;
  return value;
}

/**
 * Empty on purpose. GSC, findings, and catalog rows live in the Brain public
 * schema. This route stays in os and does not call a platform.
 */
function stubRead(tool: McpReadTool, clientId: string, storeId: string | null, body: ReadBody): Record<string, unknown> {
  const read: Record<string, unknown> = {
    clientId,
    storeId,
    lastSyncedAt: null,
    sourceSystem: "stub",
    availability: "not_synced",
    limit: body.limit,
    nextCursor: null,
  };
  if (tool === "get_gsc_performance") {
    read.dateStart = body.dateStart;
    read.dateEnd = body.dateEnd;
    read.view = body.view;
    if (body.view !== "pages") read.queries = [];
    if (body.view !== "queries") read.pages = [];
    return read;
  }
  if (tool === "get_seo_findings") {
    read.status = body.status;
    read.findings = [];
    return read;
  }
  read.products = [];
  read.collections = [];
  return read;
}

/**
 * cerevex-mcp principal only. A missing grant and a missing client are the same 404.
 * Shape is checked before the grant so a bad limit is not a tenant oracle.
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
      .select({ clientId: clients.id, siteId: clients.siteId })
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
    return c.json({
      ok: true,
      read: stubRead(parsed.data.tool, row.clientId, publicStoreId(row.siteId), parsed.data),
    });
  });
}
