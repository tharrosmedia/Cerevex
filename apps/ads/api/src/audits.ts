import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { EVENTS, canMutate } from "@tharros/ads-shared";
import { evaluateApplyGate } from "@tharros/ads-shared/apply-gate";
import {
  createAuditRun,
  decideRecommendation,
  getAuditBundle,
  getRecommendation,
  latestAuthorization,
  listAuditRuns,
  listRecommendations,
  runAuditRun,
  toAuthorizationPublic,
  toRecommendationPublic,
} from "@tharros/ads-shared/audit";
import { getDb } from "@tharros/ads-shared/db";
import { sendApplyRequested, sendAuditRequested } from "@tharros/ads-shared/inngest";
import { applyJobs, workspaces } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { requireMutableClient, requireVisibleAccount } from "./connect";
import { childLogger } from "./logger";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const startAuditSchema = z.object({
  adAccountId: z.string().uuid().optional(),
  inline: z.boolean().optional(),
});

const decideSchema = z.object({
  action: z.enum(["authorize", "deny", "snooze"]),
  note: z.string().max(1000).optional(),
});

export function registerAuditRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.post("/clients/:id/audits", requireAuth, async (c) => {
    const parsed = startAuditSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "Invalid audit request" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, c.req.param("id"));
    if (parsed.data.adAccountId) {
      const account = await requireVisibleAccount(auth, parsed.data.adAccountId);
      if (!account || account.clientId !== client.id) {
        throw new HTTPException(404, { message: "Ad account not found" });
      }
    }

    const run = await createAuditRun({
      workspaceId: client.workspaceId,
      clientId: client.id,
      requestedBy: auth.user.id,
      adAccountId: parsed.data.adAccountId,
    });

    if (parsed.data.inline) {
      const bundle = await runAuditRun(run.id);
      childLogger(c.get("requestId")).info({
        msg: "audits.inline_complete",
        auditRunId: run.id,
        findingCount: bundle.findings.length,
        recommendationCount: bundle.recommendations.length,
        writes: false,
      });
      return c.json({
        audit: bundle.audit,
        findings: bundle.findings,
        recommendations: bundle.recommendations,
        status: bundle.audit.status,
        name: EVENTS.auditRequested,
        inline: true,
        writes: false,
      });
    }

    try {
      const ids = await sendAuditRequested({
        requestedBy: auth.user.id,
        workspaceId: client.workspaceId,
        clientId: client.id,
        auditRunId: run.id,
        adAccountId: parsed.data.adAccountId,
      });
      childLogger(c.get("requestId")).info({
        msg: "jobs.audit_enqueued",
        event: EVENTS.auditRequested,
        jobId: ids[0],
        auditRunId: run.id,
      });
      return c.json({
        jobId: ids[0] ?? "unknown",
        audit: {
          id: run.id,
          workspaceId: run.workspaceId,
          clientId: run.clientId,
          status: run.status,
          startedAt: null,
          finishedAt: null,
          summary: run.summaryJson,
          createdAt: run.createdAt.toISOString(),
        },
        name: EVENTS.auditRequested,
        status: "queued",
        writes: false,
      });
    } catch (error) {
      childLogger(c.get("requestId")).error({ err: error, msg: "jobs.audit_send_failed" });
      throw new HTTPException(503, {
        message:
          "Inngest is not reachable. Use { \"inline\": true } for mock-mode smoke, or start the local Dev Server (npm run ads:dev).",
      });
    }
  });

  app.get("/clients/:id/audits", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    return c.json({ audits: await listAuditRuns(client.id), writes: false });
  });

  app.get("/audits/:id", requireAuth, async (c) => {
    try {
      const bundle = await getAuditBundle(c.req.param("id"));
      if (!bundle.audit.clientId) {
        throw new HTTPException(404, { message: "Audit run not found" });
      }
      const client = await getVisibleClient(c.get("auth"), bundle.audit.clientId);
      if (!client) {
        throw new HTTPException(404, { message: "Audit run not found" });
      }
      return c.json({ ...bundle, writes: false });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(404, { message: "Audit run not found" });
    }
  });

  app.get("/clients/:id/recommendations", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    return c.json({ recommendations: await listRecommendations(client.id), writes: false });
  });

  app.get("/recommendations/:id", requireAuth, async (c) => {
    const row = await getRecommendation(c.req.param("id"));
    if (!row) {
      throw new HTTPException(404, { message: "Recommendation not found" });
    }
    const client = await getVisibleClient(c.get("auth"), row.clientId);
    if (!client) {
      throw new HTTPException(404, { message: "Recommendation not found" });
    }
    const authorization = await latestAuthorization(row.id);
    return c.json({
      recommendation: toRecommendationPublic(row),
      authorization: authorization ? toAuthorizationPublic(authorization) : null,
      writes: false,
    });
  });

  app.post("/recommendations/:id/decide", requireAuth, async (c) => {
    const parsed = decideSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "action must be authorize, deny, or snooze" });
    }
    const row = await getRecommendation(c.req.param("id"));
    if (!row) {
      throw new HTTPException(404, { message: "Recommendation not found" });
    }
    const client = await requireMutableClient(c.get("auth"), row.clientId);
    const result = await decideRecommendation({
      recommendationId: row.id,
      userId: c.get("auth").user.id,
      action: parsed.data.action,
      note: parsed.data.note,
    });
    childLogger(c.get("requestId")).info({
      msg: "recommendations.decided",
      recommendationId: row.id,
      action: parsed.data.action,
      authorizationId: result.authorization?.id ?? null,
      applied: false,
      clientId: client.id,
    });
    return c.json({
      ...result,
      applied: false,
      writes: false,
      note: "Decision recorded. Apply is a separate step and remains blocked by the kill switch.",
    });
  });

  app.post("/recommendations/:id/apply", requireAuth, async (c) => {
    const row = await getRecommendation(c.req.param("id"));
    if (!row) {
      throw new HTTPException(404, { message: "Recommendation not found" });
    }
    const client = await requireMutableClient(c.get("auth"), row.clientId);
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, client.workspaceId),
    });
    const authorization = await latestAuthorization(row.id);
    const gate = evaluateApplyGate({
      expectedWorkspaceId: client.workspaceId,
      workspace,
      authorization,
    });

    if (gate.blocked === "authorization_required" || gate.blocked === "authorization_revoked" || gate.blocked === "authorization_expired") {
      throw new HTTPException(409, {
        message: `Apply blocked (${gate.blocked}). Authorize the recommendation first. No platform writes.`,
      });
    }

    if (!authorization) {
      throw new HTTPException(409, { message: "Authorization required. No platform writes." });
    }

    const [job] = await db
      .insert(applyJobs)
      .values({
        workspaceId: client.workspaceId,
        clientId: client.id,
        authorizationId: authorization.id,
        status: workspace?.applyKillSwitch ? "blocked" : "pending",
        requestJson: {
          recommendationId: row.id,
          writes: false,
          proposedMutations: row.proposedMutationsJson,
        },
        error: gate.blocked,
      })
      .returning();

    let jobId = job.id;
    try {
      const ids = await sendApplyRequested({
        requestedBy: c.get("auth").user.id,
        workspaceId: client.workspaceId,
        clientId: client.id,
        authorizationId: authorization.id,
        applyJobId: job.id,
      });
      jobId = ids[0] ?? job.id;
      childLogger(c.get("requestId")).info({
        msg: "jobs.apply_enqueued",
        jobId,
        authorizationId: authorization.id,
        blocked: gate.blocked,
        writes: false,
      });
    } catch {
      childLogger(c.get("requestId")).info({
        msg: "jobs.apply_blocked_without_inngest",
        applyJobId: job.id,
        blocked: gate.blocked,
        writes: false,
      });
    }

    return c.json(
      {
        ok: false,
        error: `Apply blocked (${gate.blocked}). Kill switch default ON. No Meta/Google writes.`,
        jobId,
        applyJobId: job.id,
        name: EVENTS.applyRequested,
        ...gate,
        note: "Authorize-to-apply enforced. Kill switch default ON. No Meta/Google writes.",
      },
      409,
    );
  });

  app.get("/workspace", requireAuth, async (c) => {
    const auth = c.get("auth");
    const workspaceId = auth.memberships[0]?.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(403, { message: "No workspace membership" });
    }
    const workspace = await getDb().query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    return c.json({
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            applyKillSwitch: workspace.applyKillSwitch,
          }
        : null,
      canMutate: workspace ? canMutate(auth, workspace.id) : false,
    });
  });
}
