import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  bookedJobSignalWriteBlockedReason,
  brandGuardrailsWriteBlockedReason,
  budgetShiftWriteBlockedReason,
  creativeFatigueWriteBlockedReason,
  geoDisciplineWriteBlockedReason,
  isCapabilityOn,
  ownerWeeklyNarrativeWriteBlockedReason,
  resolveWorkspaceCapabilities,
  searchNegativesWriteBlockedReason,
  seasonalityWriteBlockedReason,
} from "@cerevex/contracts";
import { evaluateApplyGate } from "./apply-gate";
import { getDefaultSiteConnector } from "./connectors/site";
import { crmWriteBlockedReason } from "./lead-lifecycle";
import { siteApplyBlockedReason } from "./lp-intelligence";
import { parseApplyMutations } from "./audit-schemas";
import { getDb } from "./db";
import { executeMutation, type MutationOutcome } from "./mutate";
import {
  inferApplyJobType,
  isSealedCreateEntityJob,
  mutationFamilySkipReason,
  MUTATION_FAMILIES,
  type ApplyJobType,
} from "./mutation-families";
import {
  adAccounts,
  applyJobs,
  auditLog,
  authorizations,
  recommendations,
  workspaces,
} from "./schema";
import type { ApplyJobPublic } from "./types";

export function applyJobIdempotencyKey(recommendationId: string): string {
  return `apply:${recommendationId}`;
}

export function toApplyJobPublic(row: typeof applyJobs.$inferSelect): ApplyJobPublic {
  const status = row.status === "pending" ? "queued" : row.status;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    authorizationId: row.authorizationId,
    status,
    attempts: row.attempts,
    error: row.error,
    request: (row.requestJson as Record<string, unknown>) ?? {},
    response: (row.responseJson as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

export async function latestApplyJob(recommendationId: string) {
  const db = getDb();
  const rec = await db.query.recommendations.findFirst({
    where: eq(recommendations.id, recommendationId),
  });
  if (!rec) return null;
  const authzRows = await db
    .select()
    .from(authorizations)
    .where(eq(authorizations.recommendationId, recommendationId))
    .orderBy(desc(authorizations.id))
    .limit(1);
  const authz = authzRows[0];
  if (!authz) return null;
  const jobs = await db
    .select()
    .from(applyJobs)
    .where(eq(applyJobs.authorizationId, authz.id))
    .orderBy(desc(applyJobs.createdAt))
    .limit(1);
  return jobs[0] ?? null;
}

export async function findApplyJobByIdempotency(key: string) {
  const rows = await getDb().select().from(applyJobs).where(eq(applyJobs.idempotencyKey, key)).limit(1);
  return rows[0] ?? null;
}

export type ApplyRunResult = {
  applyJob: ApplyJobPublic;
  outcomes: MutationOutcome[];
  writes: boolean;
  blocked: string | null;
};

/** A platform write is history. Revocation does not turn it into a failed non-write. */
export function applyResultAuditAction(result: { writes: boolean; applyJob: { status: string } }): "apply_success" | "apply_fail" {
  if (result.writes || result.applyJob.status === "succeeded") return "apply_success";
  return "apply_fail";
}

function authorizationStillApplies(
  job: { workspaceId: string },
  authorization:
    | { workspaceId: string; revokedAt: Date | null; expiresAt: Date | null }
    | null
    | undefined,
  recommendation: { status: string } | null | undefined,
  now = new Date(),
): boolean {
  if (!authorization || authorization.workspaceId !== job.workspaceId) return false;
  if (authorization.revokedAt) return false;
  if (authorization.expiresAt && authorization.expiresAt.getTime() <= now.getTime()) return false;
  return recommendation?.status === "authorized";
}

type ApplyJobRow = typeof applyJobs.$inferSelect;
type RecommendationRow = typeof recommendations.$inferSelect;
type AccountRow = typeof adAccounts.$inferSelect;

type PreparedApply = {
  job: ApplyJobRow;
  recommendation: RecommendationRow;
  account: AccountRow;
  capabilities: ReturnType<typeof resolveWorkspaceCapabilities>;
  jobType: ApplyJobType;
};

type ApplyHandle = {
  insert: ReturnType<typeof getDb>["insert"];
  update: ReturnType<typeof getDb>["update"];
  query: ReturnType<typeof getDb>["query"];
  select: ReturnType<typeof getDb>["select"];
};

function publicResult(
  job: ApplyJobRow,
  extras: { outcomes?: MutationOutcome[]; writes?: boolean; blocked?: string | null } = {},
): ApplyRunResult {
  return {
    applyJob: toApplyJobPublic(job),
    outcomes: extras.outcomes ?? [],
    writes: extras.writes ?? false,
    blocked: extras.blocked ?? null,
  };
}

async function saveJob(
  tx: ApplyHandle,
  job: ApplyJobRow,
  patch: {
    status: string;
    error: string | null;
    response: Record<string, unknown>;
    attempts?: number;
    finished?: boolean;
  },
  extras: { outcomes?: MutationOutcome[]; writes?: boolean; blocked?: string | null } = {},
): Promise<ApplyRunResult> {
  await tx
    .update(applyJobs)
    .set({
      status: patch.status,
      error: patch.error,
      responseJson: patch.response,
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
      ...(patch.finished === false ? {} : { finishedAt: new Date() }),
    })
    .where(eq(applyJobs.id, job.id));
  const updated = await tx.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
  return publicResult(updated ?? job, extras);
}

async function auditRevoked(
  tx: ApplyHandle,
  job: ApplyJobRow,
  recommendationId: string | null,
): Promise<void> {
  await tx.insert(auditLog).values({
    workspaceId: job.workspaceId,
    actorType: "worker",
    actorId: null,
    action: "revoked",
    entityType: "apply_job",
    entityId: job.id,
    payloadJson: {
      recommendationId,
      authorizationId: job.authorizationId,
      outcome: "revoked",
      writes: false,
    },
  });
}

function storedRun(job: ApplyJobRow, blocked: string | null = null): ApplyRunResult {
  const stored = (job.responseJson as { outcomes?: MutationOutcome[]; writes?: boolean } | null) ?? null;
  return publicResult(job, {
    outcomes: stored?.outcomes ?? [],
    writes: blocked === "in_progress" ? false : Boolean(stored?.writes),
    blocked,
  });
}

/**
 * One conditional update owns the job. Only queued or pending can become applying.
 * A second caller, including inline apply, sees applying and does not call the platform.
 * The checks below commit before any platform I/O. An applying job is never reclaimed.
 */
async function claimApplyJob(
  applyJobId: string,
): Promise<{ kind: "done"; result: ApplyRunResult } | { kind: "run"; prepared: PreparedApply }> {
  const [claimed] = await getDb()
    .update(applyJobs)
    .set({
      status: "applying",
      attempts: sql`${applyJobs.attempts} + 1`,
      error: null,
    })
    .where(and(eq(applyJobs.id, applyJobId), inArray(applyJobs.status, ["queued", "pending"])))
    .returning();

  if (!claimed) {
    const existing = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, applyJobId) });
    if (!existing) throw new Error("Apply job not found");
    if (existing.status === "applying") {
      return { kind: "done" as const, result: storedRun(existing, "in_progress") };
    }
    return { kind: "done" as const, result: storedRun(existing) };
  }

  return getDb().transaction(async (tx) => {
    const handle = tx as unknown as ApplyHandle;
    const job = claimed;

    const [authPeek] = await tx
      .select()
      .from(authorizations)
      .where(eq(authorizations.id, job.authorizationId));
    if (authPeek) {
      await tx
        .select({ id: recommendations.id })
        .from(recommendations)
        .where(eq(recommendations.id, authPeek.recommendationId))
        .for("update");
      await tx
        .select({ id: authorizations.id })
        .from(authorizations)
        .where(eq(authorizations.id, authPeek.id))
        .for("update");
    }

    const authorization = await handle.query.authorizations.findFirst({
      where: eq(authorizations.id, job.authorizationId),
    });
    const recommendation = authorization
      ? await handle.query.recommendations.findFirst({
          where: eq(recommendations.id, authorization.recommendationId),
        })
      : null;
    const account = recommendation
      ? await handle.query.adAccounts.findFirst({ where: eq(adAccounts.id, recommendation.adAccountId) })
      : null;
    const workspace = await handle.query.workspaces.findFirst({
      where: eq(workspaces.id, job.workspaceId),
    });

    if (!authorizationStillApplies(job, authorization, recommendation)) {
      const response = { writes: false, outcomes: [] as MutationOutcome[], blocked: "authorization_revoked", revoked: true };
      await auditRevoked(handle, job, recommendation?.id ?? authorization?.recommendationId ?? null);
      return {
        kind: "done" as const,
        result: await saveJob(
          handle,
          job,
          { status: "failed", error: "authorization_revoked", response },
          { blocked: "authorization_revoked" },
        ),
      };
    }

    const gate = evaluateApplyGate({
      expectedWorkspaceId: job.workspaceId,
      workspace,
      authorization,
      account,
    });
    if (!gate.allowed) {
      const response = { ...gate, outcomes: [], writes: false };
      return {
        kind: "done" as const,
        result: await saveJob(
          handle,
          job,
          { status: "failed", error: gate.blocked, response },
          { blocked: gate.blocked },
        ),
      };
    }

    if (!recommendation || !account) {
      const response = { writes: false, outcomes: [] };
      return {
        kind: "done" as const,
        result: await saveJob(
          handle,
          job,
          {
            status: "failed",
            error: "recommendation_or_account_missing",
            response,
          },
          { blocked: "recommendation_or_account_missing" },
        ),
      };
    }

    const capabilities = resolveWorkspaceCapabilities(workspace?.settingsJson);
    const request = (job.requestJson as Record<string, unknown> | null) ?? {};
    const jobType = (
      typeof request.jobType === "string" ? request.jobType : inferApplyJobType(request.proposedMutations)
    ) as ApplyJobType;

    const stopped = await stopBeforePlatform(handle, job, recommendation, capabilities, jobType);
    if (stopped) return { kind: "done" as const, result: stopped };

    return {
      kind: "run" as const,
      prepared: { job, recommendation, account, capabilities, jobType },
    };
  });
}

async function stopBeforePlatform(
  tx: ApplyHandle,
  job: ApplyJobRow,
  recommendation: RecommendationRow,
  capabilities: ReturnType<typeof resolveWorkspaceCapabilities>,
  jobType: ApplyJobType,
): Promise<ApplyRunResult | null> {
  if (!isCapabilityOn("apply", capabilities)) {
    return saveJob(
      tx,
      job,
      {
        status: "succeeded",
        error: null,
        response: { writes: false, outcomes: [], blocked: "capability_apply", jobType, mode: "mock" },
      },
      { blocked: "capability_apply" },
    );
  }

  const early: Array<{ blocked: string | null; reason: string; extra?: Record<string, unknown> }> = [
    {
      blocked: crmWriteBlockedReason(recommendation.type),
      reason: "Lead lifecycle is recommend-only. CRM apply later — nothing writes Housecall Pro.",
      extra: { crmWrite: "later" },
    },
    {
      blocked: bookedJobSignalWriteBlockedReason(capabilities, recommendation.type),
      reason: "Booked-job signal is recommend-only or off. No platform write.",
    },
    {
      blocked: siteApplyBlockedReason(getDefaultSiteConnector(), recommendation.type),
      reason: "LP intelligence is recommend-only. Site apply later — nothing writes the website.",
      extra: { siteApply: "later" },
    },
    {
      blocked: creativeFatigueWriteBlockedReason(capabilities, recommendation.type),
      reason: "Creative fatigue is recommend-only or off. No platform write.",
    },
    {
      blocked: searchNegativesWriteBlockedReason(capabilities, recommendation.type),
      reason: "Search-term hygiene is recommend-only or off. No platform write.",
    },
    {
      blocked: geoDisciplineWriteBlockedReason(capabilities, recommendation.type),
      reason: "Geo / service-area is recommend-only or off. No platform write.",
    },
    {
      blocked: brandGuardrailsWriteBlockedReason(capabilities, recommendation.type),
      reason: "Brand guardrails are recommend-only or off. No platform write.",
    },
    {
      blocked: seasonalityWriteBlockedReason(capabilities, recommendation.type),
      reason: "Seasonality calendar is recommend-only or off. No platform write.",
    },
    {
      blocked: ownerWeeklyNarrativeWriteBlockedReason(capabilities, recommendation.type),
      reason: "Owner weekly narrative is recommend-only or off. The digest does not write live ads.",
    },
    {
      blocked: budgetShiftWriteBlockedReason(capabilities, recommendation.type),
      reason: "Budget shift is recommend-only or off. No platform write.",
    },
  ];
  for (const row of early) {
    if (!row.blocked) continue;
    return saveJob(
      tx,
      job,
      {
        status: "succeeded",
        error: null,
        response: {
          writes: false,
          outcomes: [],
          blocked: row.blocked,
          jobType,
          mode: "mock",
          reason: row.reason,
          ...row.extra,
        },
      },
      { blocked: row.blocked },
    );
  }

  if (isSealedCreateEntityJob(jobType) && !isCapabilityOn("apply.create_entity", capabilities)) {
    const sealed = mutationFamilySkipReason(MUTATION_FAMILIES.create_entity);
    return saveJob(
      tx,
      job,
      {
        status: "succeeded",
        error: null,
        response: {
          writes: false,
          outcomes: [],
          blocked: "create_entity_sealed",
          jobType,
          mode: "mock",
          reason: sealed,
        },
      },
      { blocked: "create_entity_sealed" },
    );
  }
  return null;
}

async function executePrepared(prepared: PreparedApply): Promise<{
  outcomes: MutationOutcome[];
  failed: string | null;
  response: Record<string, unknown>;
}> {
  const mutations = parseApplyMutations(prepared.recommendation.proposedMutationsJson);
  const outcomes: MutationOutcome[] = [];
  let failed: string | null = null;
  for (const mutation of mutations) {
    if (mutation.platform !== prepared.account.platform) {
      outcomes.push({
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "skipped",
        mode: "mock",
        writes: false,
        reason: `Mutation platform ${mutation.platform} does not match account ${prepared.account.platform}.`,
      });
      continue;
    }
    try {
      const outcome = await executeMutation({
        adAccountId: prepared.account.id,
        platform: prepared.account.platform,
        accountExternalId: prepared.account.externalId,
        mutation,
        capabilities: prepared.capabilities,
      });
      outcomes.push(outcome);
      if (outcome.status === "failed") {
        failed = outcome.reason ?? `${outcome.action} failed`;
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Apply mutation failed";
      outcomes.push({
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "failed",
        mode: "live",
        writes: false,
        reason: message,
      });
      failed = message;
      break;
    }
  }
  const writes = outcomes.some((row) => row.writes && row.status === "applied");
  return {
    outcomes,
    failed,
    response: {
      writes,
      outcomes,
      mode: outcomes.some((row) => row.mode === "live") ? "live" : "mock",
      createNewSkipped: outcomes
        .filter((row) => row.status === "skipped" && /create-new|Create-new/i.test(row.reason ?? ""))
        .map((row) => row.action),
      jobType: prepared.jobType,
    },
  };
}

async function settleApplyJob(
  jobId: string,
  executed: { outcomes: MutationOutcome[]; failed: string | null; response: Record<string, unknown> },
): Promise<ApplyRunResult> {
  return getDb().transaction(async (tx) => {
    const handle = tx as unknown as ApplyHandle;
    const [job] = await tx.select().from(applyJobs).where(eq(applyJobs.id, jobId)).for("update");
    if (!job) throw new Error("Apply job not found");
    const [authorization] = await tx
      .select()
      .from(authorizations)
      .where(eq(authorizations.id, job.authorizationId));
    if (authorization) {
      await tx
        .select({ id: recommendations.id })
        .from(recommendations)
        .where(eq(recommendations.id, authorization.recommendationId))
        .for("update");
      await tx
        .select({ id: authorizations.id })
        .from(authorizations)
        .where(eq(authorizations.id, authorization.id))
        .for("update");
    }
    const freshAuth = await handle.query.authorizations.findFirst({
      where: eq(authorizations.id, job.authorizationId),
    });
    const recommendation = freshAuth
      ? await handle.query.recommendations.findFirst({
          where: eq(recommendations.id, freshAuth.recommendationId),
        })
      : null;
    if (!authorizationStillApplies(job, freshAuth, recommendation)) {
      const writes = executed.outcomes.some((row) => row.writes && row.status === "applied");
      const response = {
        ...executed.response,
        writes,
        outcomes: executed.outcomes,
        revokedDuringApply: true,
        revoked_after_write: writes,
        blocked: writes ? null : "authorization_revoked",
      };
      await handle.insert(auditLog).values({
        workspaceId: job.workspaceId,
        actorType: "worker",
        actorId: null,
        action: writes ? "apply_success" : "apply_fail",
        entityType: "apply_job",
        entityId: job.id,
        payloadJson: {
          recommendationId: recommendation?.id ?? freshAuth?.recommendationId ?? null,
          authorizationId: job.authorizationId,
          writes,
          outcomes: executed.outcomes,
          revokedDuringApply: true,
          revoked_after_write: writes,
        },
      });
      return saveJob(
        handle,
        job,
        {
          status: writes ? "succeeded" : "failed",
          error: writes ? "revoked_after_write" : "authorization_revoked",
          response,
          finished: true,
        },
        {
          outcomes: executed.outcomes,
          writes,
          blocked: writes ? "revoked_after_write" : "authorization_revoked",
        },
      );
    }
    const writes = executed.outcomes.some((row) => row.writes && row.status === "applied");
    return saveJob(
      handle,
      job,
      {
        status: executed.failed ? "failed" : "succeeded",
        error: executed.failed,
        response: executed.response,
        finished: true,
      },
      { outcomes: executed.outcomes, writes, blocked: null },
    );
  });
}

export async function runApplyJob(applyJobId: string): Promise<ApplyRunResult> {
  const claimed = await claimApplyJob(applyJobId);
  if (claimed.kind === "done") return claimed.result;
  const executed = await executePrepared(claimed.prepared);
  return settleApplyJob(claimed.prepared.job.id, executed);
}
