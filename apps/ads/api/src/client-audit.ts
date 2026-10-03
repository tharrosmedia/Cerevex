import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { canApproveApply, canMutate, workspaceRole } from "@tharros/ads-shared";
import { getDb } from "@tharros/ads-shared/db";
import {
  exportClientAuditLog,
  listClientAuditLog,
  readApproval,
  recordRecLifecycle,
  servicePrincipalRefused,
  setWorkspaceRole,
  streamClientAuditCsv,
  type AuditListQuery,
} from "@tharros/ads-shared/rec-lifecycle";
import { memberships } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { getRecommendation } from "@tharros/ads-shared/audit";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const lifecycleSchema = z.object({
  kind: z.enum([
    "approved",
    "rejected",
    "mark_done",
    "rolled_back",
    "prompt_layer_approved",
    "prompt_layer_rolled_back",
  ]),
  recommendationId: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  storeId: z.string().max(200).nullable().optional(),
  module: z.string().min(1).max(80).optional(),
  version: z.string().min(1).max(80).optional(),
  note: z.string().max(1000).optional(),
});

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["owner", "operator", "client_readonly"]),
  workspaceId: z.string().uuid().optional(),
});

function filtersFrom(url: URL, clientId: string): Omit<AuditListQuery, "limit" | "cursor"> {
  return {
    clientId,
    storeId: url.searchParams.get("store") || url.searchParams.get("storeId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    approver: url.searchParams.get("approver"),
    module: url.searchParams.get("module"),
    action: url.searchParams.get("action"),
  };
}

export function registerClientAuditRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/audit-log", requireAuth, async (c) => {
    const auth = c.get("auth");
    const client = await getVisibleClient(auth, c.req.param("id"));
    if (!client) throw new HTTPException(404, { message: "Client not found" });
    const url = new URL(c.req.url);
    const limit = Number(url.searchParams.get("limit") ?? "");
    const result = await listClientAuditLog({
      ...filtersFrom(url, client.id),
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      cursor: url.searchParams.get("cursor"),
    });
    return c.json(result);
  });

  app.get("/clients/:id/audit-log/export", requireAuth, async (c) => {
    const auth = c.get("auth");
    const client = await getVisibleClient(auth, c.req.param("id"));
    if (!client) throw new HTTPException(404, { message: "Client not found" });
    const url = new URL(c.req.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const exported = await exportClientAuditLog(filtersFrom(url, client.id));
    if (format === "json") {
      return c.json(exported, 200, {
        "x-export-truncated": exported.truncated ? "1" : "0",
        "x-export-limit": String(exported.limit),
      });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of streamClientAuditCsv(exported.rows)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-log-${client.id}.csv"`,
        "x-export-truncated": exported.truncated ? "1" : "0",
        "x-export-limit": String(exported.limit),
      },
    });
  });

  app.post("/recommendations/lifecycle", requireAuth, async (c) => {
    const parsed = lifecycleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid audit event" });
    const auth = c.get("auth");
    const client = await getVisibleClient(auth, parsed.data.clientId);
    if (!client) throw new HTTPException(404, { message: "Not found" });
    if (!canMutate(auth, client.workspaceId)) {
      throw new HTTPException(403, { message: "Owner or operator role required" });
    }
    if (servicePrincipalRefused(auth.principal, parsed.data.kind)) {
      throw new HTTPException(403, {
        message: "The service key cannot approve, mark done, roll back, or change the prompt layer.",
      });
    }
    const personKinds = new Set(["approved", "mark_done", "rolled_back", "prompt_layer_approved", "prompt_layer_rolled_back"]);
    if (personKinds.has(parsed.data.kind) && !canApproveApply(auth.user.email)) {
      throw new HTTPException(403, { message: "Approve is limited to the Adam allowlist during soft-launch." });
    }

    if (parsed.data.kind === "prompt_layer_approved" || parsed.data.kind === "prompt_layer_rolled_back") {
      if (!parsed.data.version) throw new HTTPException(400, { message: "version is required" });
      const row = await recordRecLifecycle({
        kind: parsed.data.kind,
        workspaceId: client.workspaceId,
        clientId: client.id,
        storeId: parsed.data.storeId,
        module: "prompt-layer",
        actorType: "user",
        actorId: auth.user.id,
        entityType: "prompt_layer",
        version: parsed.data.version,
        payload: parsed.data.note ? { note: parsed.data.note } : {},
      });
      return c.json({ event: row, writes: false });
    }

    if (parsed.data.kind === "approved" || parsed.data.kind === "rejected") {
      throw new HTTPException(409, { message: "Approve and deny go through the decide route." });
    }
    if (!parsed.data.recommendationId) {
      throw new HTTPException(400, { message: "recommendationId is required" });
    }
    const rec = await getRecommendation(parsed.data.recommendationId);
    if (!rec || rec.clientId !== client.id) throw new HTTPException(404, { message: "Not found" });
    const approval = readApproval(rec.approvalJson);
    if (parsed.data.kind === "mark_done" && approval.executed_at) {
      throw new HTTPException(409, { message: "This recommendation is already marked done." });
    }
    if (parsed.data.kind === "mark_done" && approval.status !== "approved") {
      throw new HTTPException(409, { message: "Approve this recommendation before marking it done." });
    }
    if (parsed.data.kind === "rolled_back" && !approval.executed_at) {
      throw new HTTPException(409, { message: "Nothing has been applied yet, so there is nothing to roll back." });
    }
    const row = await recordRecLifecycle({
      kind: parsed.data.kind,
      recommendationId: rec.id,
      workspaceId: rec.workspaceId,
      clientId: rec.clientId,
      storeId: parsed.data.storeId,
      module: parsed.data.module ?? "ads",
      actorType: "user",
      actorId: auth.user.id,
      entityType: "recommendation",
      entityId: rec.id,
      payload: parsed.data.note ? { note: parsed.data.note } : {},
    });
    return c.json({ event: row, writes: false });
  });

  app.post("/memberships/role", requireAuth, async (c) => {
    const parsed = roleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "userId and role are required" });
    const auth = c.get("auth");
    const db = getDb();
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, parsed.data.userId));
    const membership = parsed.data.workspaceId
      ? membershipRows.find((row) => row.workspaceId === parsed.data.workspaceId)
      : membershipRows[0];
    if (!membership) throw new HTTPException(404, { message: "Membership not found" });
    if (workspaceRole(auth, membership.workspaceId) !== "owner") {
      throw new HTTPException(403, { message: "Only an admin can change roles." });
    }
    await setWorkspaceRole({
      workspaceId: membership.workspaceId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      actorId: auth.user.id,
    });
    return c.json({ ok: true, writes: false });
  });
}
