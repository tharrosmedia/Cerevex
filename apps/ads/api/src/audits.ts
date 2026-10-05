import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  applyBlockMessage,
  applyBusinessTypeSettings,
  applyCapabilityOverrideSettings,
  applyModuleOverrideSettings,
  canApproveApply,
  canMutate,
  type AuthContext,
  workspaceRole,
  capabilityOnBlockedReason,
  CAPABILITY_IDS,
  EVENTS,
  isBusinessType,
  isCapabilityId,
  isCapabilityState,
  toWorkspaceSummary,
} from "@tharros/ads-shared";
import { applySafetyOnIds, resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { capabilityPublicMeta, loadWorkspaceCapabilities, requireWritableCapability } from "./capabilities";
import { filterOfflineRecommendations } from "./offline";
import {
  applyResultAuditAction,
  latestApplyJob,
  requeueFailedApplyJob,
  runApplyJob,
  shouldRecordApplyAudit,
  toApplyJobPublic,
} from "@tharros/ads-shared/apply";
import { evaluateApplyGate } from "@tharros/ads-shared/apply-gate";
import {
  createApplyJobForAuthorization,
  RecommendationGateError,
  RecommendationNotOpenError,
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
import { LifecycleRepeatError, readApproval, recordRecLifecycle } from "@tharros/ads-shared/rec-lifecycle";
import { sendApplyRequested, sendAuditRequested } from "@tharros/ads-shared/inngest";
import { adAccounts, workspaces } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { actorRef, auditActor, assertApplySafetyOwner, isServicePrincipal } from "./auth";
import { requireMutableClient, requireVisibleAccount } from "./connect";
import { childLogger } from "./logger";
import { getVisibleClient, listVisibleClients } from "./tenancy";
import type { AppEnv } from "./types";

const REC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A requested id must be one of the caller's memberships. Anything else is not found. */
function memberWorkspace(auth: AuthContext, requested: string | null | undefined): string {
  const id = requested?.trim();
  if (id) {
    if (!auth.memberships.some((row) => row.workspaceId === id)) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }
    return id;
  }
  const workspaceId = auth.memberships[0]?.workspaceId;
  if (!workspaceId) throw new HTTPException(403, { message: "No workspace membership" });
  return workspaceId;
}

function assertRecommendationId(id: string) {
  if (!REC_UUID.test(id)) {
    throw new HTTPException(400, { message: "Invalid recommendation id" });
  }
}

const startAuditSchema = z.object({
  adAccountId: z.string().uuid().optional(),
  inline: z.boolean().optional(),
});

const decideSchema = z.object({
  action: z.enum(["authorize", "approve", "deny", "snooze", "mark_done", "rollback"]),
  note: z.string().max(1000).optional(),
  inline: z.boolean().optional(),
});

function normalizeDecisionAction(action: "authorize" | "approve" | "deny" | "snooze") {
  return action === "approve" ? "authorize" : action;
}

async function recordApproveRefusal(
  row: { id: string; workspaceId: string; clientId: string },
  actor: { actorType: "user" | "service"; actorId: string | null },
  reason: string,
): Promise<void> {
  await recordRecLifecycle({
    kind: "approve_refused",
    recommendationId: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    module: "ads",
    actorType: actor.actorType,
    actorId: actor.actorId,
    entityType: "recommendation",
    entityId: row.id,
    payload: { reason },
  });
}

const SERVICE_FORBIDDEN = "Service credentials cannot approve or apply.";
const RECOMMENDATION_NOT_FOUND = "Recommendation not found";

async function recommendationForMutation(auth: AuthContext, id: string) {
  const row = await getRecommendation(id);
  if (!row) {
    throw new HTTPException(404, { message: RECOMMENDATION_NOT_FOUND });
  }
  const visible = await getVisibleClient(auth, row.clientId);
  if (!visible || !canMutate(auth, visible.workspaceId)) {
    throw new HTTPException(404, { message: RECOMMENDATION_NOT_FOUND });
  }
  return { row, client: visible };
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

    await requireWritableCapability(client.workspaceId, "audits");

    const actor = auditActor(auth);
    const run = await createAuditRun({
      workspaceId: client.workspaceId,
      clientId: client.id,
      requestedBy: actorRef(auth),
      actorType: actor.actorType,
      actorId: actor.actorId,
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
        requestedBy: actorRef(auth),
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
    const workspaceId = scoped[0]?.workspaceId;
    if (workspaceId) {
      const { flags } = await loadWorkspaceCapabilities(workspaceId);
      recommendations = filterOfflineRecommendations(recommendations, flags);
    }
    return c.json({ recommendations, writes: false });
  });

  app.get("/clients/:id/recommendations", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    const { flags } = await loadWorkspaceCapabilities(client.workspaceId);
    return c.json({
      recommendations: filterOfflineRecommendations(await listRecommendations(client.id), flags),
      writes: false,
    });
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
      canApprove: canApproveApply(auth.user?.email) && canMutate(auth, client.workspaceId) && !isServicePrincipal(auth),
      applyGate: gate,
      writes: false,
    });
  });

  app.post("/recommendations/:id/decide", requireAuth, async (c) => {
    assertRecommendationId(c.req.param("id"));
    const parsed = decideSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "action must be approve, deny, snooze, mark_done, or rollback" });
    }
    const auth = c.get("auth");
    const personAction =
      parsed.data.action === "mark_done" ||
      parsed.data.action === "rollback" ||
      parsed.data.action === "authorize" ||
      parsed.data.action === "approve";
    if (personAction && isServicePrincipal(auth)) {
      throw new HTTPException(403, { message: SERVICE_FORBIDDEN });
    }
    const { row, client } = await recommendationForMutation(auth, c.req.param("id"));
    const actor = auditActor(auth);
    const db = getDb();

    if (parsed.data.action === "mark_done" || parsed.data.action === "rollback") {
      if (!canApproveApply(auth.user?.email)) {
        await recordApproveRefusal(row, actor, "allowlist");
        throw new HTTPException(403, {
          message: "Approve is limited to the Adam allowlist during soft-launch.",
        });
      }
      const approval = readApproval(row.approvalJson);
      if (parsed.data.action === "mark_done" && approval.executed_at) {
        throw new HTTPException(409, { message: "This recommendation is already marked done." });
      }
      if (parsed.data.action === "mark_done" && approval.status !== "approved") {
        await recordApproveRefusal(row, actor, "mark_done_before_approve");
        throw new HTTPException(409, { message: "Approve this recommendation before marking it done." });
      }
      if (parsed.data.action === "rollback" && approval.rolled_back_at) {
        throw new HTTPException(409, { message: "This recommendation is already rolled back." });
      }
      if (parsed.data.action === "rollback" && !approval.executed_at) {
        await recordApproveRefusal(row, actor, "rollback_before_execute");
        throw new HTTPException(409, { message: "Nothing has been applied yet, so there is nothing to roll back." });
      }
      try {
        await recordRecLifecycle({
          kind: parsed.data.action === "mark_done" ? "mark_done" : "rolled_back",
          recommendationId: row.id,
          workspaceId: row.workspaceId,
          clientId: row.clientId,
          module: "ads",
          actorType: actor.actorType,
          actorId: actor.actorId,
          entityType: "recommendation",
          entityId: row.id,
          payload: parsed.data.note ? { note: parsed.data.note } : {},
        });
      } catch (error) {
        if (error instanceof LifecycleRepeatError) {
          throw new HTTPException(409, { message: error.message });
        }
        throw error;
      }
      const updated = await getRecommendation(row.id);
      return c.json({
        recommendation: updated ? toRecommendationPublic(updated) : toRecommendationPublic(row),
        client: { id: client.id, name: client.name },
        writes: false,
        applied: false,
        note:
          parsed.data.action === "mark_done"
            ? "Marked done. Nothing new was sent to Meta or Google."
            : "Rollback recorded. Nothing new was sent to Meta or Google.",
      });
    }

    const action = normalizeDecisionAction(parsed.data.action);

    if (action === "authorize") {
      if (!canApproveApply(auth.user?.email)) {
        await recordApproveRefusal(row, actor, "allowlist");
        throw new HTTPException(403, {
          message: "Approve is limited to the Adam allowlist during soft-launch.",
        });
      }
      if (row.status !== "proposed") {
        await recordApproveRefusal(row, actor, "not_open");
        throw new HTTPException(409, { message: "This recommendation is no longer open." });
      }
      const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, client.workspaceId),
      });
      const account = await db.query.adAccounts.findFirst({
        where: eq(adAccounts.id, row.adAccountId),
      });
      if (workspace?.applyKillSwitch) {
        await recordApproveRefusal(row, actor, "apply_kill_switch");
        throw new HTTPException(409, { message: applyBlockMessage("apply_kill_switch") });
      }
      if (account?.frozen) {
        await recordApproveRefusal(row, actor, "account_frozen");
        throw new HTTPException(409, { message: applyBlockMessage("account_frozen") });
      }
    }

    let result: Awaited<ReturnType<typeof decideRecommendation>>;
    try {
      result = await decideRecommendation({
        recommendationId: row.id,
        userId: actor.actorId,
        actorType: actor.actorType,
        action,
        note: parsed.data.note,
      });
    } catch (error) {
      if (error instanceof RecommendationNotOpenError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof RecommendationGateError) {
        await recordApproveRefusal(row, actor, error.reason);
        throw new HTTPException(409, { message: applyBlockMessage(error.reason) });
      }
      throw error;
    }

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
      ...auditActor(auth),
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
      if (shouldRecordApplyAudit(ran)) {
        await writeAuditEvent({
          workspaceId: client.workspaceId,
          actorType: "worker",
          actorId: auditActor(auth).actorId,
          action: applyResultAuditAction(ran),
          entityType: "apply_job",
          entityId: applyJob.id,
          payload: {
            recommendationId: row.id,
            writes: ran.writes,
            outcomes: ran.outcomes,
            error: ran.applyJob.error,
            revokedDuringApply: ran.blocked === "revoked_after_write",
          },
        });
      }
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
        requestedBy: actorRef(auth),
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
    assertRecommendationId(c.req.param("id"));
    const auth = c.get("auth");
    if (isServicePrincipal(auth)) {
      throw new HTTPException(403, { message: SERVICE_FORBIDDEN });
    }
    const parsed = z
      .object({
        inline: z.boolean().optional(),
        requeue: z.boolean().optional(),
        reconciled: z.boolean().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    const requeue = parsed.success && parsed.data.requeue === true;
    const reconciled = parsed.success && parsed.data.reconciled === true;
    const { row, client } = await recommendationForMutation(auth, c.req.param("id"));
    const actor = auditActor(auth);
    if (readApproval(row.approvalJson).executed_at) {
      throw new HTTPException(409, { message: "This recommendation is already done. Nothing was written." });
    }
    if (!canApproveApply(auth.user?.email)) {
      await recordApproveRefusal(row, actor, "allowlist");
      throw new HTTPException(403, {
        message: "Apply is limited to the Adam allowlist during soft-launch.",
      });
    }
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
      await recordApproveRefusal(row, actor, gate.blocked ?? "apply_blocked");
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

    if (requeue) {
      assertApplySafetyOwner(auth, client.workspaceId);
      if (applyJob.status !== "failed") {
        throw new HTTPException(409, { message: "Only a failed apply can be requeued." });
      }
      const requeued = await requeueFailedApplyJob(applyJob.id, { reconciled });
      if (!requeued.ok) {
        const message =
          requeued.reason === "write_landed" || requeued.reason === "not_repeatable"
            ? "That apply may already have changed the ad. Requeue stays closed."
            : requeued.reason === "unreconciled_write"
              ? "Requeue needs a reconciled read of the live ad before it can run again."
              : "Only a failed apply can be requeued.";
        throw new HTTPException(409, { message });
      }
      await recordRecLifecycle({
        kind: "apply_requeue",
        recommendationId: row.id,
        workspaceId: client.workspaceId,
        clientId: client.id,
        module: "ads",
        actorType: actor.actorType,
        actorId: actor.actorId,
        entityType: "recommendation",
        entityId: row.id,
        applyResult: "queued",
        before: applyJob.response ?? null,
        after: { status: "queued", applyJobId: requeued.applyJob.id },
      });
      await writeAuditEvent({
        workspaceId: client.workspaceId,
        ...auditActor(auth),
        action: "apply_requeue",
        entityType: "apply_job",
        entityId: applyJob.id,
        payload: { recommendationId: row.id },
      });
      try {
        await sendApplyRequested({
          requestedBy: actorRef(auth),
          workspaceId: client.workspaceId,
          clientId: client.id,
          authorizationId: authorization!.id,
          applyJobId: requeued.applyJob.id,
        });
      } catch {
        /* queued locally even if Inngest is down */
      }
      return c.json({
        ok: true,
        status: "queued",
        applyJob: requeued.applyJob,
        writes: false,
        name: EVENTS.applyRequested,
        note: "Failed apply was requeued. Live ads change only after the worker runs.",
      });
    }

    if (applyJob.status === "failed" || applyJob.status === "succeeded") {
      return c.json({
        ok: applyJob.status === "succeeded",
        status: applyJob.status,
        applyJob,
        writes: false,
        note: applyJob.status === "succeeded" ? "Apply already finished." : "Apply already failed.",
      });
    }

    await writeAuditEvent({
      workspaceId: client.workspaceId,
      ...auditActor(auth),
      action: "apply_attempt",
      entityType: "apply_job",
      entityId: applyJob.id,
      payload: { recommendationId: row.id, retry: false },
    });

    if (parsed.success && parsed.data.inline) {
      const ran = await runApplyJob(applyJob.id);
      if (ran.blocked === "in_progress") {
        return c.json(
          {
            status: "in_progress",
            applyJob: ran.applyJob,
            writes: false,
            note: "Apply is already in progress.",
          },
          409,
        );
      }
      if (shouldRecordApplyAudit(ran)) {
        await writeAuditEvent({
          workspaceId: client.workspaceId,
          actorType: "worker",
          actorId: auditActor(auth).actorId,
          action: applyResultAuditAction(ran),
          entityType: "apply_job",
          entityId: applyJob.id,
          payload: {
            recommendationId: row.id,
            writes: ran.writes,
            outcomes: ran.outcomes,
            revokedDuringApply: ran.blocked === "revoked_after_write",
          },
        });
      }
      return c.json({
        ok: ran.applyJob.status === "succeeded",
        status: ran.applyJob.status,
        applyJob: ran.applyJob,
        ...gate,
        writes: ran.writes,
      });
    }

    try {
      await sendApplyRequested({
        requestedBy: actorRef(auth),
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

  const capabilityPatchSchema = z.record(
    z.string(),
    z.enum(["on", "hidden", "recommend_only"]),
  );

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
      capabilities: capabilityPatchSchema.optional(),
      workspaceId: z.string().uuid().optional(),
    })
    .refine(
      (value) =>
        Boolean(
          value.businessType ||
            value.modules ||
            value.applyKillSwitch !== undefined ||
            value.capabilities,
        ),
      {
        message: "businessType, modules, capabilities, or applyKillSwitch is required",
      },
    );

  app.get("/workspace", requireAuth, async (c) => {
    const auth = c.get("auth");
    const workspaceId = memberWorkspace(auth, c.req.query("workspaceId"));
    const workspace = await getDb().query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    const summary = workspace ? toWorkspaceSummary(workspace) : null;
    return c.json({
      workspace: summary,
      ownerUserId: auth.user?.id ?? null,
      canMutate: workspace ? canMutate(auth, workspace.id) : false,
      canApprove: canApproveApply(auth.user?.email) && !isServicePrincipal(auth),
      ...(summary ? capabilityPublicMeta(summary.capabilities) : {}),
    });
  });

  app.patch("/workspace", requireAuth, async (c) => {
    const auth = c.get("auth");
    const parsed = workspacePatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: "businessType, modules, capabilities, or applyKillSwitch is required",
      });
    }
    const workspaceId = memberWorkspace(auth, parsed.data.workspaceId);
    if (!canMutate(auth, workspaceId)) {
      throw new HTTPException(403, { message: "Only owners and operators can change modules" });
    }
    const workspace = await getDb().query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    if (!workspace) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }

    const safetyOns = applySafetyOnIds(parsed.data.capabilities);
    const needsOwner =
      parsed.data.applyKillSwitch === false ||
      safetyOns.length > 0 ||
      (isServicePrincipal(auth) && parsed.data.applyKillSwitch !== undefined);
    if (needsOwner && (isServicePrincipal(auth) || workspaceRole(auth, workspaceId) !== "owner")) {
      const flags = resolveWorkspaceCapabilities(workspace.settingsJson);
      for (const id of safetyOns) {
        await writeAuditEvent({
          workspaceId,
          ...auditActor(auth),
          action: "capability_flip",
          entityType: "workspace",
          entityId: workspaceId,
          payload: { capability: id, from: flags[id], to: "on", allowed: false },
        });
      }
      assertApplySafetyOwner(auth, workspaceId);
    }

    let next = workspace.settingsJson as unknown;
    if (parsed.data.businessType && isBusinessType(parsed.data.businessType)) {
      next = applyBusinessTypeSettings(next, parsed.data.businessType);
    }
    if (parsed.data.modules) {
      next = applyModuleOverrideSettings(next, parsed.data.modules);
    }
    if (parsed.data.capabilities) {
      const overrides: Record<string, "on" | "hidden" | "recommend_only"> = {};
      for (const [id, state] of Object.entries(parsed.data.capabilities)) {
        if (isCapabilityId(id) && isCapabilityState(state)) overrides[id] = state;
      }
      if (Object.keys(overrides).length === 0) {
        throw new HTTPException(400, { message: `Unknown capability. Known: ${CAPABILITY_IDS.join(", ")}` });
      }
      for (const [id, state] of Object.entries(overrides)) {
        const blocked = isCapabilityId(id) ? capabilityOnBlockedReason(id, state) : null;
        if (blocked) {
          throw new HTTPException(409, { message: blocked });
        }
      }
      next = applyCapabilityOverrideSettings(next, overrides);
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
        ...auditActor(auth),
        action: "kill_flip",
        entityType: "workspace",
        entityId: workspaceId,
        payload: { applyKillSwitch: parsed.data.applyKillSwitch },
      });
    }
    if (safetyOns.length > 0) {
      const previous = resolveWorkspaceCapabilities(workspace.settingsJson);
      for (const id of safetyOns) {
        await writeAuditEvent({
          workspaceId,
          ...auditActor(auth),
          action: "capability_flip",
          entityType: "workspace",
          entityId: workspaceId,
          payload: { capability: id, from: previous[id], to: "on", allowed: true },
        });
      }
    }

    childLogger(c.get("requestId")).info({
      msg: "workspace.updated",
      workspaceId,
      ...(auth.user ? { userId: auth.user.id } : { actor: auth.principal }),
      businessType: parsed.data.businessType,
      modules: parsed.data.modules,
      capabilities: parsed.data.capabilities,
      applyKillSwitch: parsed.data.applyKillSwitch,
    });

    const summary = updated
      ? toWorkspaceSummary(updated)
      : toWorkspaceSummary({ ...workspace, settingsJson: next });
    return c.json({
      workspace: summary,
      ownerUserId: auth.user?.id ?? null,
      canMutate: true,
      canApprove: canApproveApply(auth.user?.email) && !isServicePrincipal(auth),
      ...capabilityPublicMeta(summary.capabilities),
    });
  });
}
