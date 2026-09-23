import { desc, eq } from "drizzle-orm";
import { budgetShiftWriteBlockedReason, isCapabilityOn, resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { evaluateApplyGate } from "./apply-gate";
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

export async function runApplyJob(applyJobId: string): Promise<ApplyRunResult> {
  const db = getDb();
  const job = await db.query.applyJobs.findFirst({
    where: eq(applyJobs.id, applyJobId),
  });
  if (!job) {
    throw new Error("Apply job not found");
  }

  if (job.status === "succeeded") {
    return {
      applyJob: toApplyJobPublic(job),
      outcomes: ((job.responseJson as { outcomes?: MutationOutcome[] } | null)?.outcomes ?? []),
      writes: Boolean((job.responseJson as { writes?: boolean } | null)?.writes),
      blocked: null,
    };
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, job.workspaceId),
  });
  const authorization = await db.query.authorizations.findFirst({
    where: eq(authorizations.id, job.authorizationId),
  });
  const recommendation = authorization
    ? await db.query.recommendations.findFirst({
        where: eq(recommendations.id, authorization.recommendationId),
      })
    : null;
  const account = recommendation
    ? await db.query.adAccounts.findFirst({
        where: eq(adAccounts.id, recommendation.adAccountId),
      })
    : null;

  const gate = evaluateApplyGate({
    expectedWorkspaceId: job.workspaceId,
    workspace,
    authorization,
    account,
  });

  await db
    .update(applyJobs)
    .set({
      status: gate.allowed ? "applying" : "failed",
      attempts: job.attempts + 1,
      error: gate.allowed ? null : gate.blocked,
    })
    .where(eq(applyJobs.id, job.id));

  if (!gate.allowed) {
    const response = { ...gate, outcomes: [], writes: false };
    await db
      .update(applyJobs)
      .set({
        status: "failed",
        error: gate.blocked,
        finishedAt: new Date(),
        responseJson: response,
      })
      .where(eq(applyJobs.id, job.id));
    const updated = await db.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    return {
      applyJob: toApplyJobPublic(updated ?? job),
      outcomes: [],
      writes: false,
      blocked: gate.blocked,
    };
  }

  if (!recommendation || !account) {
    await db
      .update(applyJobs)
      .set({
        status: "failed",
        error: "recommendation_or_account_missing",
        finishedAt: new Date(),
        responseJson: { writes: false, outcomes: [] },
      })
      .where(eq(applyJobs.id, job.id));
    throw new Error("Recommendation or ad account missing for apply job");
  }

  const capabilities = resolveWorkspaceCapabilities(workspace?.settingsJson);
  const request = (job.requestJson as Record<string, unknown> | null) ?? {};
  const jobType = (typeof request.jobType === "string" ? request.jobType : inferApplyJobType(request.proposedMutations)) as ApplyJobType;

  if (!isCapabilityOn("apply", capabilities)) {
    const response = {
      writes: false,
      outcomes: [],
      blocked: "capability_apply",
      jobType,
      mode: "mock",
    };
    await db
      .update(applyJobs)
      .set({
        status: "succeeded",
        error: null,
        finishedAt: new Date(),
        responseJson: response,
      })
      .where(eq(applyJobs.id, job.id));
    const updated = await db.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    return {
      applyJob: toApplyJobPublic(updated ?? job),
      outcomes: [],
      writes: false,
      blocked: "capability_apply",
    };
  }

  const budgetShiftBlocked = budgetShiftWriteBlockedReason(capabilities, recommendation.type);
  if (budgetShiftBlocked) {
    const response = {
      writes: false,
      outcomes: [],
      blocked: budgetShiftBlocked,
      jobType,
      mode: "mock",
      reason: "Budget shift is recommend-only or off. No platform write.",
    };
    await db
      .update(applyJobs)
      .set({
        status: "succeeded",
        error: null,
        finishedAt: new Date(),
        responseJson: response,
      })
      .where(eq(applyJobs.id, job.id));
    const updated = await db.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    return {
      applyJob: toApplyJobPublic(updated ?? job),
      outcomes: [],
      writes: false,
      blocked: budgetShiftBlocked,
    };
  }

  if (isSealedCreateEntityJob(jobType) && !isCapabilityOn("apply.create_entity", capabilities)) {
    const sealed = mutationFamilySkipReason(MUTATION_FAMILIES.create_entity);
    const response = {
      writes: false,
      outcomes: [],
      blocked: "create_entity_sealed",
      jobType,
      mode: "mock",
      reason: sealed,
    };
    await db
      .update(applyJobs)
      .set({
        status: "succeeded",
        error: null,
        finishedAt: new Date(),
        responseJson: response,
      })
      .where(eq(applyJobs.id, job.id));
    const updated = await db.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    return {
      applyJob: toApplyJobPublic(updated ?? job),
      outcomes: [],
      writes: false,
      blocked: "create_entity_sealed",
    };
  }

  const mutations = parseApplyMutations(recommendation.proposedMutationsJson);
  const outcomes: MutationOutcome[] = [];
  let failed: string | null = null;

  for (const mutation of mutations) {
    if (mutation.platform !== account.platform) {
      outcomes.push({
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "skipped",
        mode: "mock",
        writes: false,
        reason: `Mutation platform ${mutation.platform} does not match account ${account.platform}.`,
      });
      continue;
    }
    try {
      const outcome = await executeMutation({
        adAccountId: account.id,
        platform: account.platform,
        accountExternalId: account.externalId,
        mutation,
        capabilities,
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
  const status = failed ? "failed" : "succeeded";
  const response = {
    writes,
    outcomes,
    mode: outcomes.some((row) => row.mode === "live") ? "live" : "mock",
    createNewSkipped: outcomes
      .filter((row) => row.status === "skipped" && /create-new|Create-new/i.test(row.reason ?? ""))
      .map((row) => row.action),
    jobType,
  };

  await db
    .update(applyJobs)
    .set({
      status,
      error: failed,
      finishedAt: new Date(),
      responseJson: response,
    })
    .where(eq(applyJobs.id, job.id));

  const updated = await db.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
  return {
    applyJob: toApplyJobPublic(updated ?? { ...job, status, error: failed, responseJson: response }),
    outcomes,
    writes,
    blocked: null,
  };
}
