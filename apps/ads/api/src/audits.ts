import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  applyBlockMessage,
  applyBusinessTypeSettings,
  applyModuleOverrideSettings,
  canApproveApply,
  canMutate,
  EVENTS,
  isBusinessType,
  toWorkspaceSummary,
} from "@tharros/ads-shared";
import { latestApplyJob, runApplyJob, toApplyJobPublic } from "@tharros/ads-shared/apply";
import { evaluateApplyGate } from "@tharros/ads-shared/apply-gate";
import {
  createApplyJobForAuthorization,
  createAuditRun,
  decideRecommendation,
  getAuditBundle,
  getFinding,
  getRecommendation,
  latestAuthorization,
  listAuditRuns,
  listAuditRunsForClients,
  listRecommendations,
  listRecommendationsForClients,
  runAuditRun,
  toAuthorizationPublic,
  toFindingPublic,
  toRecommendationPublic,
  writeAuditEvent,
} from "@tharros/ads-shared/audit";
import { getDb } from "@tharros/ads-shared/db";
import { sendApplyRequested, sendAuditRequested } from "@tharros/ads-shared/inngest";
import { adAccounts, workspaces } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { requireMutableClient, requireVisibleAccount } from "./connect";
import { childLogger } from "./logger";
import { getVisibleClient, listVisibleClients } from "./tenancy";
import type { AppEnv } from "./types";

const startAuditSchema = z.object({
  adAccountId: z.string().uuid().optional(),
  inline: z.boolean().optional(),
});

const decideSchema = z.object({
  action: z.enum(["authorize", "approve", "deny", "snooze"]),
  note: z.string().max(1000).optional(),
  inline: z.boolean().optional(),
});

function normalizeDecisionAction(action: "authorize" | "approve" | "deny" | "snooze") {
  return action === "approve" ? "authorize" : action;
}

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

  app.get("/audits", requireAuth, async (c) => {
    const visible = await listVisibleClients(c.get("auth"));
    const clientId = c.req.query("clientId");
    const status = c.req.query("status");
    const scoped = clientId ? visible.filter((row) => row.id === clientId) : visible;
    if (clientId && scoped.length === 0) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    let audits = await listAuditRunsForClients(scoped.map((row) => row.id));
    if (status) {
      audits = audits.filter((row) => row.status === status);
    }
    return c.json({ audits, writes: false });
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

  app.get("/recommendations", requireAuth, async (c) => {
    const visible = await listVisibleClients(c.get("auth"));
    const clientId = c.req.query("clientId");
    const status = c.req.query("status");
    const scoped = clientId ? visible.filter((row) => row.id === clientId) : visible;
    if (clientId && scoped.length === 0) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    let recommendations = await listRecommendationsForClients(scoped.map((row) => row.id));
    if (status) {
      recommendations = recommendations.filter((row) => row.status === status);
    }
    return c.json({ recommendations, writes: false });
  });

  app.get("/clients/:id/recommendations", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    return c.json({ recommendations: await listRecommendations(client.id), writes: false });
  });

  app.get("/findings/:id", requireAuth, async (c) => {
    const row = await getFinding(c.req.param("id"));
    if (!row) {
      throw new HTTPException(404, { message: "Finding not found" });
    }
    if (!row.clientId) {
      throw new HTTPException(404, { message: "Finding not found" });
    }
    const client = await getVisibleClient(c.get("auth"), row.clientId);
    if (!client) {
      throw new HTTPException(404, { message: "Finding not found" });
    }
    return c.json({ finding: toFindingPublic(row), writes: false });
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
    const applyJob = await latestApplyJob(row.id);
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, client.workspaceId),
    });
    const account = await db.query.adAccounts.findFirst({
      where: eq(adAccounts.id, row.adAccountId),
    });
    const gate = evaluateApplyGate({
      expectedWorkspaceId: client.workspaceId,
      workspace,
      authorization,
      account,
    });
    const auth = c.get("auth");
    return c.json({
      recommendation: toRecommendationPublic(row),
      authorization: authorization ? toAuthorizationPublic(authorization) : null,
      applyJob: applyJob ? toApplyJobPublic(applyJob) : null,
      client: { id: client.id, name: client.name },
      adAccount: account
        ? {
            id: account.id,
            platform: account.platform,
            externalId: account.externalId,
            frozen: Boolean(account.frozen),
            connectionStatus: account.connectionStatus,
          }
        : null,
      canApprove: canApproveApply(auth.user.email) && canMutate(auth, client.workspaceId),
      applyGate: gate,
      writes: false,
    });
  });

  app.post("/recommendations/:id/decide", requireAuth, async (c) => {
    const parsed = decideSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "action must be approve, deny, or snooze" });
    }
    const action = normalizeDecisionAction(parsed.data.action);
    const row = await getRecommendation(c.req.param("id"));
    if (!row) {
      throw new HTTPException(404, { message: "Recommendation not found" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, row.clientId);
    const db = getDb();

    if (action === "authorize") {
      if (!canApproveApply(auth.user.email)) {
        throw new HTTPException(403, {
          message: "Approve is limited to the Adam allowlist during soft-launch.",
        });
      }
      if (row.status !== "proposed") {
        throw new HTTPException(409, { message: "This recommendation is no longer open." });
      }
      const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, client.workspaceId),
      });
      const account = await db.query.adAccounts.findFirst({
        where: eq(adAccounts.id, row.adAccountId),
      });
      if (workspace?.applyKillSwitch) {
        throw new HTTPException(409, { message: applyBlockMessage("apply_kill_switch") });
      }
      if (account?.frozen) {
        throw new HTTPException(409, { message: applyBlockMessage("account_frozen") });
      }
    }

    const result = await decideRecommendation({
      recommendationId: row.id,
      userId: auth.user.id,
      action,
      note: parsed.data.note,
    });

    if (action !== "authorize") {
      childLogger(c.get("requestId")).info({
        msg: "recommendations.decided",
        recommendationId: row.id,
        action,
        applied: false,
        writes: false,
        clientId: client.id,
      });
      return c.json({
        ...result,
        applyJob: null,
        applied: false,
        writes: false,
        note: action === "deny" ? "Denied. Nothing was written to Meta or Google." : "Snoozed. Nothing was written to Meta or Google.",
      });
    }

    const applyJob = await createApplyJobForAuthorization({
      workspaceId: client.workspaceId,
      clientId: client.id,
      authorizationId: result.authorization!.id,
      recommendationId: row.id,
      proposedMutations: row.proposedMutationsJson,
    });

    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "apply_attempt",
      entityType: "apply_job",
      entityId: applyJob.id,
      payload: {
        recommendationId: row.id,
        authorizationId: result.authorization!.id,
        inline: Boolean(parsed.data.inline),
      },
    });

    if (parsed.data.inline) {
      const ran = await runApplyJob(applyJob.id);
      await writeAuditEvent({
        workspaceId: client.workspaceId,
        actorType: "worker",
        actorId: auth.user.id,
        action: ran.applyJob.status === "succeeded" ? "apply_success" : "apply_fail",
        entityType: "apply_job",
        entityId: applyJob.id,
        payload: {
          recommendationId: row.id,
          writes: ran.writes,
          outcomes: ran.outcomes,
          error: ran.applyJob.error,
        },
      });
      childLogger(c.get("requestId")).info({
        msg: "recommendations.approved_inline",
        recommendationId: row.id,
        applyJobId: applyJob.id,
        status: ran.applyJob.status,
        writes: ran.writes,
      });
      return c.json({
        ...result,
        applyJob: ran.applyJob,
        applied: ran.applyJob.status === "succeeded",
        writes: ran.writes,
        name: EVENTS.applyRequested,
        note: ran.applyJob.status === "succeeded"
          ? "Approved and applied."
          : `Approved but apply ${ran.applyJob.status}.`,
      });
    }

    try {
      await sendApplyRequested({
        requestedBy: auth.user.id,
        workspaceId: client.workspaceId,
        clientId: client.id,
        authorizationId: result.authorization!.id,
        applyJobId: applyJob.id,
      });
    } catch {
      childLogger(c.get("requestId")).info({
        msg: "jobs.apply_enqueued_without_inngest",
        applyJobId: applyJob.id,
      });
    }

    childLogger(c.get("requestId")).info({
      msg: "recommendations.approved",
      recommendationId: row.id,
      applyJobId: applyJob.id,
      authorizationId: result.authorization!.id,
    });
    return c.json({
      ...result,
      applyJob,
      applied: false,
      writes: false,
      name: EVENTS.applyRequested,
      note: "Approved. Apply is queued and will change live ads only after the worker runs.",
    });
  });

  app.post("/recommendations/:id/apply", requireAuth, async (c) => {
    const parsed = z.object({ inline: z.boolean().optional() }).safeParse(await c.req.json().catch(() => ({})));
    const row = await getRecommendation(c.req.param("id"));
    if (!row) {
      throw new HTTPException(404, { message: "Recommendation not found" });
    }
    const auth = c.get("auth");
    if (!canApproveApply(auth.user.email)) {
      throw new HTTPException(403, {
        message: "Apply is limited to the Adam allowlist during soft-launch.",
      });
    }
    const client = await requireMutableClient(auth, row.clientId);
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, client.workspaceId),
    });
    const account = await db.query.adAccounts.findFirst({
      where: eq(adAccounts.id, row.adAccountId),
    });
    const authorization = await latestAuthorization(row.id);
    const gate = evaluateApplyGate({
      expectedWorkspaceId: client.workspaceId,
      workspace,
      authorization,
      account,
    });

    if (!gate.allowed) {
      throw new HTTPException(409, {
        message: applyBlockMessage(gate.blocked),
      });
    }

    const applyJob = await createApplyJobForAuthorization({
      workspaceId: client.workspaceId,
      clientId: client.id,
      authorizationId: authorization!.id,
      recommendationId: row.id,
      proposedMutations: row.proposedMutationsJson,
    });

    await writeAuditEvent({
      workspaceId: client.workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "apply_attempt",
      entityType: "apply_job",
      entityId: applyJob.id,
      payload: { recommendationId: row.id, retry: true },
    });

    if (parsed.success && parsed.data.inline) {
      const ran = await runApplyJob(applyJob.id);
      await writeAuditEvent({
        workspaceId: client.workspaceId,
        actorType: "worker",
        actorId: auth.user.id,
        action: ran.applyJob.status === "succeeded" ? "apply_success" : "apply_fail",
        entityType: "apply_job",
        entityId: applyJob.id,
        payload: { recommendationId: row.id, writes: ran.writes, outcomes: ran.outcomes },
      });
      return c.json({
        ok: ran.applyJob.status === "succeeded",
        applyJob: ran.applyJob,
        ...gate,
        writes: ran.writes,
      });
    }

    try {
      await sendApplyRequested({
        requestedBy: auth.user.id,
        workspaceId: client.workspaceId,
        clientId: client.id,
        authorizationId: authorization!.id,
        applyJobId: applyJob.id,
      });
    } catch {
      /* queued locally even if Inngest is down */
    }

    return c.json({
      ok: true,
      applyJob,
      name: EVENTS.applyRequested,
      status: "queued",
      ...gate,
    });
  });

  const workspacePatchSchema = z
    .object({
      businessType: z.enum(["home_service", "agency", "ecommerce"]).optional(),
      applyKillSwitch: z.boolean().optional(),
      modules: z
        .object({
          leads: z.boolean().optional(),
          clients: z.boolean().optional(),
          sales: z.boolean().optional(),
          workflows: z.boolean().optional(),
        })
        .optional(),
    })
    .refine((value) => Boolean(value.businessType || value.modules || value.applyKillSwitch !== undefined), {
      message: "businessType, modules, or applyKillSwitch is required",
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
      workspace: workspace ? toWorkspaceSummary(workspace) : null,
      canMutate: workspace ? canMutate(auth, workspace.id) : false,
      canApprove: canApproveApply(auth.user.email),
    });
  });

  app.patch("/workspace", requireAuth, async (c) => {
    const auth = c.get("auth");
    const workspaceId = auth.memberships[0]?.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(403, { message: "No workspace membership" });
    }
    if (!canMutate(auth, workspaceId)) {
      throw new HTTPException(403, { message: "Only owners and operators can change modules" });
    }
    const parsed = workspacePatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "businessType, modules, or applyKillSwitch is required" });
    }

    const workspace = await getDb().query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    if (!workspace) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }

    let next = workspace.settingsJson as unknown;
    if (parsed.data.businessType && isBusinessType(parsed.data.businessType)) {
      next = applyBusinessTypeSettings(next, parsed.data.businessType);
    }
    if (parsed.data.modules) {
      next = applyModuleOverrideSettings(next, parsed.data.modules);
    }

    const patch: { settingsJson: unknown; applyKillSwitch?: boolean } = { settingsJson: next };
    if (parsed.data.applyKillSwitch !== undefined) {
      patch.applyKillSwitch = parsed.data.applyKillSwitch;
    }

    const [updated] = await getDb()
      .update(workspaces)
      .set(patch)
      .where(eq(workspaces.id, workspaceId))
      .returning();

    if (parsed.data.applyKillSwitch !== undefined) {
      await writeAuditEvent({
        workspaceId,
        actorType: "user",
        actorId: auth.user.id,
        action: "kill_flip",
        entityType: "workspace",
        entityId: workspaceId,
        payload: { applyKillSwitch: parsed.data.applyKillSwitch },
      });
    }

    childLogger(c.get("requestId")).info({
      msg: "workspace.updated",
      workspaceId,
      userId: auth.user.id,
      businessType: parsed.data.businessType,
      modules: parsed.data.modules,
      applyKillSwitch: parsed.data.applyKillSwitch,
    });

    return c.json({
      workspace: updated ? toWorkspaceSummary(updated) : toWorkspaceSummary({ ...workspace, settingsJson: next }),
      canMutate: true,
      canApprove: canApproveApply(auth.user.email),
    });
  });
}
