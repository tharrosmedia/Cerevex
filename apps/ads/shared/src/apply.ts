import { desc, eq } from "drizzle-orm";
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
import { getDb, type Database } from "./db";
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
import { recordRecLifecycle } from "./rec-lifecycle";
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
  /** False when this call returned an already-finished job and must not write another audit row. */
  fresh?: boolean;
};

export async function runApplyJob(applyJobId: string): Promise<ApplyRunResult> {
  return runApplyJobUnlogged(applyJobId);
}

type AuditRecommendation = {
  id: string;
  workspaceId: string;
  clientId: string;
  proposedMutationsJson: unknown;
};

/**
 * Job status and the client audit row commit together.
 * `apply_attempt` is the pre-platform intent. `applied` is only a real write.
 * A blocked run records `apply_blocked` and leaves executed_* unset.
 */
async function settleApplyJob(input: {
  jobId: string;
  attempts?: number;
  status: string;
  error: string | null;
  responseJson: Record<string, unknown>;
  recommendation: AuditRecommendation | null;
  writes: boolean;
  blocked: string | null;
  outcomes: MutationOutcome[];
  auditKind: "apply_attempt" | "applied" | "apply_blocked" | null;
  finished: boolean;
}): Promise<typeof applyJobs.$inferSelect | undefined> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    const [row] = await database
      .update(applyJobs)
      .set({
        status: input.status,
        error: input.error,
        responseJson: input.responseJson,
        ...(input.attempts == null ? {} : { attempts: input.attempts }),
        ...(input.finished ? { finishedAt: new Date() } : {}),
      })
      .where(eq(applyJobs.id, input.jobId))
      .returning();
    if (input.auditKind && input.recommendation) {
      const applyResult =
        input.auditKind === "apply_attempt"
          ? `attempt:${input.jobId}`
          : input.blocked
            ? `error:${input.blocked}`
            : input.error
              ? `error:${input.error}`
              : input.status === "succeeded"
                ? `success:${input.jobId}`
                : `error:${input.status}`;
      await recordRecLifecycle(
        {
          kind: input.auditKind,
          recommendationId: input.recommendation.id,
          workspaceId: input.recommendation.workspaceId,
          clientId: input.recommendation.clientId,
          module: "ads",
          actorType: "worker",
          actorId: null,
          entityType: "recommendation",
          entityId: input.recommendation.id,
          applyResult,
          before: input.recommendation.proposedMutationsJson,
          after: {
            status: input.status,
            writes: input.writes,
            blocked: input.blocked,
            outcomes: input.outcomes,
            response: input.responseJson,
          },
        },
        database,
      );
    }
    return row;
  });
}

function settledResult(
  job: typeof applyJobs.$inferSelect,
  settled: typeof applyJobs.$inferSelect | undefined,
  outcomes: MutationOutcome[],
  writes: boolean,
  blocked: string | null,
): ApplyRunResult {
  return {
    applyJob: toApplyJobPublic(settled ?? job),
    outcomes,
    writes,
    blocked,
  };
}

async function runApplyJobUnlogged(applyJobId: string): Promise<ApplyRunResult> {
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
      fresh: false,
    };
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, job.workspaceId),
  });
  const authorization = await db.query.authorizations.findFirst({
    where: eq(authorizations.id, job.authorizationId),
  });
  const recommendation =
    (authorization
      ? await db.query.recommendations.findFirst({
          where: eq(recommendations.id, authorization.recommendationId),
        })
      : null) ?? null;
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

  const attempts = job.attempts + 1;
  const finishBlocked = async (
    blocked: string,
    response: object,
    status: "failed" | "succeeded" = "succeeded",
  ): Promise<ApplyRunResult> => {
    const settled = await settleApplyJob({
      jobId: job.id,
      attempts,
      status,
      error: status === "failed" ? blocked : null,
      responseJson: response as Record<string, unknown>,
      recommendation,
      writes: false,
      blocked,
      outcomes: [],
      auditKind: "apply_blocked",
      finished: true,
    });
    return settledResult(job, settled, [], false, blocked);
  };

  if (!gate.allowed) {
    const response = { ...gate, outcomes: [], writes: false };
    return finishBlocked(gate.blocked, response, "failed");
  }

  if (!recommendation || !account) {
    await settleApplyJob({
      jobId: job.id,
      attempts,
      status: "failed",
      error: "recommendation_or_account_missing",
      responseJson: { writes: false, outcomes: [] },
      recommendation,
      writes: false,
      blocked: "recommendation_or_account_missing",
      outcomes: [],
      auditKind: recommendation ? "apply_blocked" : null,
      finished: true,
    });
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
    return finishBlocked("capability_apply", response);
  }

  const crmBlocked = crmWriteBlockedReason(recommendation.type);
  if (crmBlocked) {
    const response = {
      writes: false,
      outcomes: [],
      blocked: crmBlocked,
      jobType,
      mode: "mock",
      reason: "Lead lifecycle is recommend-only. CRM apply later — nothing writes Housecall Pro.",
      crmWrite: "later",
    };
    return finishBlocked(crmBlocked, response);
  }

  const bookedJobBlocked = bookedJobSignalWriteBlockedReason(capabilities, recommendation.type);
  if (bookedJobBlocked) {
    const response = {
      writes: false,
      outcomes: [],
      blocked: bookedJobBlocked,
      jobType,
      mode: "mock",
      reason: "Booked-job signal is recommend-only or off. No platform write.",
    };
    return finishBlocked(bookedJobBlocked, response);
  }

  const siteBlocked = siteApplyBlockedReason(getDefaultSiteConnector(), recommendation.type);
  if (siteBlocked) {
    const response = {
      writes: false,
      outcomes: [],
      blocked: siteBlocked,
      jobType,
      mode: "mock",
      reason: "LP intelligence is recommend-only. Site apply later — nothing writes the website.",
      siteApply: "later",
    };
    return finishBlocked(siteBlocked, response);
  }

  const hygieneBlocks: Array<{ blocked: string | null; reason: string }> = [
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
  ];
  for (const row of hygieneBlocks) {
    if (!row.blocked) continue;
    const response = {
      writes: false,
      outcomes: [],
      blocked: row.blocked,
      jobType,
      mode: "mock",
      reason: row.reason,
    };
    return finishBlocked(row.blocked, response);
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
    return finishBlocked(budgetShiftBlocked, response);
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
    return finishBlocked("create_entity_sealed", response);
  }

  await settleApplyJob({
    jobId: job.id,
    attempts,
    status: "applying",
    error: null,
    responseJson: { writes: false, outcomes: [], phase: "attempt" },
    recommendation,
    writes: false,
    blocked: null,
    outcomes: [],
    auditKind: "apply_attempt",
    finished: false,
  });

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

  const settled = await settleApplyJob({
    jobId: job.id,
    status,
    error: failed,
    responseJson: response,
    recommendation,
    writes,
    blocked: writes ? null : failed,
    outcomes,
    auditKind: writes ? "applied" : "apply_blocked",
    finished: true,
  });
  return settledResult(job, settled, outcomes, writes, writes ? null : failed);
}
