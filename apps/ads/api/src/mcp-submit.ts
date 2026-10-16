import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { isMcpScope, parseMcpSubmitRequest, type McpScope, type McpSubmitRecommendation } from "@cerevex/contracts";
import { getDb } from "@tharros/ads-shared/db";
import { createPendingMcpRecommendation, McpRecommendationError } from "@tharros/ads-shared/mcp-recommendations";
import { clients, mcpIdentities, mcpIdentityGrants, workspaces } from "@tharros/ads-shared/schema";
import { connectorKillSwitchTripped } from "./mcp-connector";
import { logger } from "./logger";
import type { AppEnv } from "./types";

const APPROVAL_STATUSES = new Set(["PENDING_APPROVAL", "approved", "rejected"]);
const REC_STATUSES = new Set(["proposed", "authorized", "denied", "snoozed"]);

function readScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: McpScope[] = [];
  for (const item of value) {
    if (typeof item === "string" && isMcpScope(item) && !scopes.includes(item)) scopes.push(item);
  }
  return scopes;
}

function approvalStatus(value: unknown): McpSubmitRecommendation["approvalStatus"] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return typeof status === "string" && APPROVAL_STATUSES.has(status)
    ? (status as McpSubmitRecommendation["approvalStatus"])
    : null;
}

function toPublic(row: {
  outcome: "created" | "duplicate";
  id: string;
  status: string;
  approvalJson: unknown;
  source: string;
}): McpSubmitRecommendation | null {
  const approval = approvalStatus(row.approvalJson);
  if (!approval || !REC_STATUSES.has(row.status)) return null;
  if (row.outcome === "created" && (row.status !== "proposed" || approval !== "PENDING_APPROVAL")) return null;
  return {
    id: row.id,
    outcome: row.outcome,
    status: row.status as McpSubmitRecommendation["status"],
    approvalStatus: approval,
    source: row.source,
  };
}

/**
 * cerevex-mcp principal only. A missing grant and a missing client are the same 404.
 * Shape is checked before the grant so a bad field is not a tenant oracle.
 * The insert is the existing scoped recommendation path. It does not approve or apply.
 */
export function registerMcpSubmitRoute(
  app: Hono<AppEnv>,
  assertWorkspace: (header: string | undefined) => Promise<string>,
) {
  app.post("/internal/mcp/submit", async (c) => {
    const workspaceId = await assertWorkspace(c.req.header("x-cerevex-mcp-key"));
    const parsed = parseMcpSubmitRequest(await c.req.json().catch(() => null));
    if (!parsed) return c.json({ ok: false }, 400);

    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!workspace || connectorKillSwitchTripped(workspace.settingsJson)) {
      return c.json({ ok: false, error: "kill_switch" }, 403);
    }

    const [identity] = await db
      .select({ name: mcpIdentities.name, scopes: mcpIdentities.scopes })
      .from(mcpIdentities)
      .where(
        and(
          eq(mcpIdentities.id, parsed.identityId),
          eq(mcpIdentities.workspaceId, workspaceId),
          isNull(mcpIdentities.revokedAt),
        ),
      )
      .limit(1);
    if (!identity || !/^[a-z0-9-]{2,40}$/.test(identity.name)) return c.json({ ok: false }, 404);
    if (!readScopes(identity.scopes).includes("cerevex.recs.submit")) {
      return c.json({ ok: false, error: "insufficient_scope" }, 403);
    }

    const [grant] = await db
      .select({ clientId: clients.id })
      .from(mcpIdentityGrants)
      .innerJoin(clients, eq(mcpIdentityGrants.clientId, clients.id))
      .where(
        and(
          eq(mcpIdentityGrants.identityId, parsed.identityId),
          eq(clients.id, parsed.clientId),
          eq(clients.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!grant) return c.json({ ok: false }, 404);

    try {
      const stored = await createPendingMcpRecommendation({
        workspaceId,
        clientId: parsed.clientId,
        identityId: parsed.identityId,
        identityName: identity.name,
        idempotencyKey: parsed.idempotencyKey,
        type: parsed.type,
        title: parsed.title,
        rationale: parsed.rationale,
      });
      const recommendation = toPublic(stored);
      if (!recommendation) return c.json({ ok: false }, 500);
      logger.info({
        msg: "mcp.submit",
        identityId: parsed.identityId,
        clientId: parsed.clientId,
        outcome: recommendation.outcome,
        recommendationId: recommendation.id,
      });
      return c.json({ ok: true, recommendation });
    } catch (error) {
      if (error instanceof McpRecommendationError) return c.json({ ok: false }, 404);
      logger.error({ msg: "mcp.submit_failed", name: error instanceof Error ? error.name : "error" });
      return c.json({ ok: false }, 500);
    }
  });
}
