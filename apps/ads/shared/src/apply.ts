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
import { getAdPlatformConnector } from "./connectors";
import {
  APPLY_CALL_MARGIN_MS,
  APPLY_EXECUTE_DEADLINE_MS,
  ApplyCallBudgetError,
  PLATFORM_WRITE_TIMEOUT_MS,
  UnconfirmedPlatformWriteError,
  platformCallBudgetMs,
  runBudgetedPlatformCalls,
} from "./connectors/write-timeout";
import { loadTokens } from "./credentials";
import { META_TOKEN_EXPIRED } from "./meta-graph-error";
import { isMockToken } from "./live-or-loud";
import { crmWriteBlockedReason } from "./lead-lifecycle";
import { siteApplyBlockedReason } from "./lp-intelligence";
import { parseApplyMutations } from "./audit-schemas";
import { getDb, type Database } from "./db";
import { recordRecLifecycle } from "./rec-lifecycle";
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
  adEntities,
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
  /** Settle already wrote the workspace audit row. Callers must not write a second one. */
  audited?: boolean;
  /** Stored terminal job. Callers must not append another apply_fail. */
  replayed?: boolean;
  /** False when this call returned a stored job and wrote no new client-audit row. */
  fresh?: boolean;
};

/** A platform write is history. Revocation does not turn it into a failed non-write. */
export function applyResultAuditAction(result: { writes: boolean; applyJob: { status: string } }): "apply_success" | "apply_fail" {
  if (result.writes || result.applyJob.status === "succeeded") return "apply_success";
  return "apply_fail";
}

/** Callers skip their own audit when settle already wrote one, or the call did not finish the job. */
export function shouldRecordApplyAudit(result: {
  blocked: string | null;
  audited?: boolean;
  replayed?: boolean;
}): boolean {
  if (result.audited || result.replayed) return false;
  return result.blocked !== "in_progress" && result.blocked !== "stale_applying";
}

/** A live apply may hold the platform call. Past this, a later caller closes the job without calling the platform. */
export const APPLYING_LEASE_MS = 2 * 60 * 1000;

/** Execute deadline from lease time still left. Not from when executePrepared started. */
export function applyExecuteDeadlineAt(remainingMs: number, now = Date.now()): number {
  return now + Math.max(0, remainingMs - PLATFORM_WRITE_TIMEOUT_MS);
}

export {
  APPLY_CALL_MARGIN_MS,
  APPLY_EXECUTE_DEADLINE_MS,
  PLATFORM_WRITE_TIMEOUT_MS,
  UnconfirmedPlatformWriteError,
  runBudgetedPlatformCalls,
};

/**
 * A write is succeeded even when a later mutation failed. With no write, a failure stays failed.
 * Revocation uses the same split: a landed write stays succeeded.
 */
export function settledApplyJob(input: {
  writes: boolean;
  failed: string | null;
  revoked: boolean;
}): { status: "succeeded" | "failed"; error: string | null } {
  if (input.revoked) {
    return {
      status: input.writes ? "succeeded" : "failed",
      error: input.writes ? "revoked_after_write" : "authorization_revoked",
    };
  }
  if (input.writes || !input.failed) return { status: "succeeded", error: sanitizeStoredError(input.failed) };
  return { status: "failed", error: sanitizeStoredError(input.failed) };
}

/** Drop driver and constraint text. A platform message that merely says "update" stays. */
export function sanitizeStoredError(message: string | null): string | null {
  if (!message) return message;
  const rawSql =
    /\b(select|insert|update|delete)\b/i.test(message) &&
    /params:/i.test(message) &&
    /\b(set|from|into|values|where)\b/i.test(message);
  if (
    /failed query:/i.test(message) ||
    /duplicate key value/i.test(message) ||
    /violates (?:unique|foreign key|check|not-null|exclusion) constraint/i.test(message) ||
    /(?:relation|column)\s+".*"\s+does not exist/i.test(message) ||
    /invalid input syntax/i.test(message) ||
    /Key \([^)]+\)=\([^)]*\) already exists/i.test(message) ||
    rawSql ||
    /\bSQLSTATE\b\s*[0-9A-Z]{5}\b/i.test(message)
  ) {
    return "database_error";
  }
  return message.length > 500 ? message.slice(0, 500) : message;
}

export function isAbortedApplyError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/** The request left this process and the platform result was not confirmed. A skipped call is not this. */
export function isUnconfirmedApplyError(error: unknown): boolean {
  if (error instanceof ApplyCallBudgetError) return false;
  if (error instanceof UnconfirmedPlatformWriteError) return true;
  if (isAbortedApplyError(error)) return true;
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const cause =
    error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode =
    cause && typeof cause === "object" && cause && "code" in cause
      ? String((cause as { code?: unknown }).code ?? "")
      : "";
  const text = `${message} ${code} ${causeCode}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|UND_ERR_|other side closed|network error|\bterminated\b/i.test(
    text,
  );
}

export function claimTokenOf(responseJson: unknown): string | null {
  const token = (responseJson as { claimToken?: unknown } | null)?.claimToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Test fence. beforeWrite runs after the claim and before the platform call.
 * afterWrite runs after that call returns and before settle.
 */
export const applyClaimHooks: {
  beforeWrite?: (input: { jobId: string; claimToken: string | null }) => Promise<void> | void;
  afterWrite?: (input: { jobId: string; claimToken: string | null }) => Promise<void> | void;
} = {};

/** True only while this claim is still the applying row and its lease has not expired. */
export async function claimStillHeld(jobId: string, claimToken: string | null): Promise<boolean> {
  const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
  if (!job || job.status !== "applying") return false;
  if (await applyingLeaseExpired(job.responseJson)) return false;
  const token = claimTokenOf(job.responseJson);
  if (claimToken && token !== claimToken) return false;
  if (!claimToken && token) return false;
  return true;
}

/** Confirmed platform writes win. An aborted write with no confirmation stays unknown. */
export function applyOutcomeWrites(outcomes: Array<{ writes?: unknown; status?: unknown }>): boolean | "unknown" {
  if (outcomes.some((row) => row.writes === true && row.status === "applied")) return true;
  if (outcomes.some((row) => row.writes === "unknown")) return "unknown";
  return false;
}

function claimedAtText(responseJson: unknown): string | null {
  const response = responseJson as { claimedAt?: unknown } | null;
  if (!response || typeof response.claimedAt !== "string") return null;
  if (!Number.isFinite(Date.parse(response.claimedAt))) return null;
  return response.claimedAt;
}

/** Milliseconds left on the claim, using the database clock. Missing or unreadable claim times are already expired. */
export async function applyingLeaseRemainingMs(responseJson: unknown): Promise<number> {
  const claimedAt = claimedAtText(responseJson);
  if (!claimedAt) return 0;
  const result = await getDb().execute(sql`
    select greatest(
      0,
      extract(epoch from (${claimedAt}::timestamptz + (${APPLYING_LEASE_MS}::int * interval '1 millisecond') - now())) * 1000
    )::double precision as ms
  `);
  const ms = Number((result.rows[0] as { ms: number | string } | undefined)?.ms);
  if (!Number.isFinite(ms)) return 0;
  return Math.min(APPLYING_LEASE_MS, Math.max(0, Math.ceil(ms)));
}

async function applyingLeaseExpired(responseJson: unknown): Promise<boolean> {
  if (!claimedAtText(responseJson)) return true;
  return (await applyingLeaseRemainingMs(responseJson)) <= 0;
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

async function writeApplyClientAudit(
  tx: ApplyHandle,
  input: {
    kind: "apply_attempt" | "applied" | "apply_blocked";
    recommendation: RecommendationRow;
    jobId: string;
    status: string;
    writes: boolean | "unknown";
    blocked: string | null;
    error: string | null;
    outcomes: MutationOutcome[];
    response: Record<string, unknown>;
  },
): Promise<void> {
  const applyResult =
    input.kind === "apply_attempt"
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
      kind: input.kind,
      recommendationId: input.recommendation.id,
      workspaceId: input.recommendation.workspaceId,
      clientId: input.recommendation.clientId,
      module: "ads",
      actorType: "worker",
      actorId: null,
      entityType: "recommendation",
      entityId: input.recommendation.id,
      storeId: input.recommendation.storeId,
      applyResult,
      before: input.recommendation.proposedMutationsJson,
      after: {
        status: input.status,
        writes: input.writes,
        blocked: input.blocked,
        outcomes: input.outcomes,
        response: input.response,
      },
    },
    tx as unknown as Database,
  );
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
  extras: {
    outcomes?: MutationOutcome[];
    writes?: boolean;
    blocked?: string | null;
    /** Caller already holds the job row and checked this is still its claim or the stale close of that claim. */
    locked?: boolean;
    clientAudit?: {
      kind: "applied" | "apply_blocked";
      recommendation: RecommendationRow | null;
    };
  } = {},
): Promise<ApplyRunResult> {
  const token = claimTokenOf(job.responseJson);
  const held = extras.locked
    ? eq(applyJobs.id, job.id)
    : token
      ? and(eq(applyJobs.id, job.id), eq(applyJobs.status, "applying"), sql`${applyJobs.responseJson}->>'claimToken' = ${token}`)
      : and(eq(applyJobs.id, job.id), eq(applyJobs.status, "applying"));
  const [updated] = await tx
    .update(applyJobs)
    .set({
      status: patch.status,
      error: patch.error,
      responseJson: patch.response,
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
      ...(patch.finished === false ? {} : { finishedAt: new Date() }),
    })
    .where(held)
    .returning();
  if (!updated) {
    const current = await tx.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    if (!current) throw new Error("Apply job not found");
    return storedRun(current, current.status === "applying" ? "in_progress" : null);
  }
  if (extras.clientAudit?.recommendation) {
    await writeApplyClientAudit(tx, {
      kind: extras.clientAudit.kind,
      recommendation: extras.clientAudit.recommendation,
      jobId: job.id,
      status: patch.status,
      writes: extras.writes ?? false,
      blocked: extras.blocked ?? null,
      error: patch.error,
      outcomes: extras.outcomes ?? [],
      response: patch.response,
    });
  }
  const saved = await tx.query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
  return publicResult(saved ?? updated, extras);
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

function confirmedWrites(value: unknown): boolean {
  return value === true;
}

function storedRun(job: ApplyJobRow, blocked: string | null = null): ApplyRunResult {
  const stored = (job.responseJson as { outcomes?: MutationOutcome[]; writes?: unknown } | null) ?? null;
  const result = {
    ...publicResult(job, {
      outcomes: stored?.outcomes ?? [],
      writes: blocked === "in_progress" ? false : confirmedWrites(stored?.writes),
      blocked,
    }),
    fresh: false as const,
  };
  const terminal = job.status === "failed" || job.status === "succeeded";
  if (!terminal || blocked === "in_progress" || blocked === "stale_applying") return result;
  return { ...result, replayed: true };
}

/**
 * Close a crashed apply without calling the platform.
 * writes is unknown: a late runner may still land a write and then audit that outcome.
 * A missing claim time is stale: this build records claimedAt from the database clock in the claim update.
 * An owner can requeue the failed row. This close does not.
 */
async function closeStaleApplying(job: typeof applyJobs.$inferSelect): Promise<ApplyRunResult> {
  const prior = (job.responseJson as { claimedAt?: string; claimToken?: string } | null) ?? null;
  const token = claimTokenOf(prior);
  const response = {
    writes: "unknown" as const,
    outcomes: [] as MutationOutcome[],
    blocked: "stale_applying",
    claimedAt: prior?.claimedAt ?? null,
    claimToken: token,
  };
  const held = token
    ? and(
        eq(applyJobs.id, job.id),
        eq(applyJobs.status, "applying"),
        sql`${applyJobs.responseJson}->>'claimToken' = ${token}`,
      )
    : and(
        eq(applyJobs.id, job.id),
        eq(applyJobs.status, "applying"),
        sql`coalesce(${applyJobs.responseJson}->>'claimToken', '') = ''`,
      );
  const [closed] = await getDb()
    .update(applyJobs)
    .set({
      status: "failed",
      error: "stale_applying",
      responseJson: response,
      finishedAt: new Date(),
    })
    .where(held)
    .returning();
  if (!closed) {
    const current = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    if (!current) throw new Error("Apply job not found");
    return storedRun(current, current.status === "applying" ? "in_progress" : null);
  }
  await getDb().insert(auditLog).values({
    workspaceId: closed.workspaceId,
    actorType: "worker",
    actorId: null,
    action: "apply_stale",
    entityType: "apply_job",
    entityId: closed.id,
    payloadJson: {
      authorizationId: closed.authorizationId,
      writes: "unknown",
      error: "stale_applying",
    },
  });
  const authorization = await getDb().query.authorizations.findFirst({
    where: eq(authorizations.id, closed.authorizationId),
  });
  const recommendation = authorization
    ? await getDb().query.recommendations.findFirst({
        where: eq(recommendations.id, authorization.recommendationId),
      })
    : null;
  // The job row already says writes are unknown. A failed client-audit insert stays loud
  // and must not roll that close back to applying.
  if (recommendation) {
    await writeApplyClientAudit(getDb() as unknown as ApplyHandle, {
      kind: "apply_blocked",
      recommendation,
      jobId: closed.id,
      status: "failed",
      writes: "unknown",
      blocked: "stale_applying",
      error: "stale_applying",
      outcomes: [],
      response,
    });
  }
  return { ...storedRun(closed, "stale_applying"), audited: true };
}

/**
 * Close a claim that is still applying after the worker has already waited out the lease.
 * The lease must be expired on the database clock, and expectedToken must be the claim
 * the caller observed. A live or replacement claim is left applying.
 */
export async function closeApplyingJob(
  applyJobId: string,
  expectedToken?: string | null,
): Promise<ApplyRunResult> {
  const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, applyJobId) });
  if (!job) throw new Error("Apply job not found");
  if (job.status !== "applying") return storedRun(job);
  const token = claimTokenOf(job.responseJson);
  if (token) {
    if (!expectedToken || expectedToken !== token) return storedRun(job, "in_progress");
  } else if (expectedToken) {
    return storedRun(job, "in_progress");
  }
  if (!(await applyingLeaseExpired(job.responseJson))) return storedRun(job, "in_progress");
  return closeStaleApplying(job);
}

/**
 * A confirmed or unknown write stays closed unless every action is safe to repeat
 * and a real platform read proves it did not land after the old claim can no longer be running.
 * create_ad has no job-scoped key on the platform object, so it is not repeatable.
 * The failed response is kept. A copy is stored on the request so the next claim does not erase it.
 */
export async function requeueFailedApplyJob(
  applyJobId: string,
  options: { reconciled?: boolean } = {},
): Promise<
  | { ok: true; applyJob: ApplyJobPublic }
  | {
      ok: false;
      reason: "not_failed" | "unreconciled_write" | "write_landed" | "not_repeatable";
      applyJob: ApplyJobPublic | null;
    }
> {
  const current = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, applyJobId) });
  if (!current || current.status !== "failed") {
    return { ok: false, reason: "not_failed", applyJob: current ? toApplyJobPublic(current) : null };
  }
  if (current.error === META_TOKEN_EXPIRED) {
    return { ok: false, reason: "not_repeatable", applyJob: toApplyJobPublic(current) };
  }
  const writes = (current.responseJson as { writes?: unknown } | null)?.writes;
  if (writes === true || writes === "unknown") {
    if (!options.reconciled) {
      return { ok: false, reason: "unreconciled_write", applyJob: toApplyJobPublic(current) };
    }
    const decision = await reconciledRequeueDecision(current);
    if (decision !== "open") {
      return { ok: false, reason: decision, applyJob: toApplyJobPublic(current) };
    }
  }
  const request = {
    ...((current.requestJson as Record<string, unknown> | null) ?? {}),
    requeueEvidence: current.responseJson ?? null,
  };
  const [updated] = await getDb()
    .update(applyJobs)
    .set({ status: "queued", error: null, finishedAt: null, requestJson: request })
    .where(and(eq(applyJobs.id, applyJobId), eq(applyJobs.status, "failed")))
    .returning();
  if (updated) return { ok: true, applyJob: toApplyJobPublic(updated) };
  const again = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, applyJobId) });
  return { ok: false, reason: "not_failed", applyJob: again ? toApplyJobPublic(again) : null };
}

/**
 * Pause is the only action safe to run again: the next claim reads live state and skips an already-paused entity.
 * Anything else, including create_ad, stays closed once a write may have left this process.
 * There is no job id on the platform object, so a missing local row is not proof a live create did not land.
 */
async function reconciledRequeueDecision(
  job: typeof applyJobs.$inferSelect,
): Promise<"open" | "unreconciled_write" | "write_landed" | "not_repeatable"> {
  try {
    const authorization = await getDb().query.authorizations.findFirst({
      where: eq(authorizations.id, job.authorizationId),
    });
    const recommendation = authorization
      ? await getDb().query.recommendations.findFirst({
          where: eq(recommendations.id, authorization.recommendationId),
        })
      : null;
    if (!recommendation || !recommendation.adAccountId || recommendation.scope !== "ad_account") {
      return "not_repeatable";
    }
    const mutations = parseApplyMutations(recommendation.proposedMutationsJson);
    if (mutations.length === 0 || mutations.some((mutation) => mutation.action !== "pause")) {
      return "not_repeatable";
    }
    if (!(await priorClaimQuiet(job.responseJson))) return "unreconciled_write";
    for (const mutation of mutations) {
      const notLanded = await pauseNotLanded(recommendation.adAccountId, job.workspaceId, mutation);
      if (notLanded === false) return "write_landed";
      if (notLanded !== true) return "unreconciled_write";
    }
    return "open";
  } catch {
    return "unreconciled_write";
  }
}

/** True only after the lease and one full platform call budget have both elapsed. */
async function priorClaimQuiet(responseJson: unknown): Promise<boolean> {
  const claimedAt = claimedAtText(responseJson);
  if (!claimedAt) return false;
  const quietMs = APPLYING_LEASE_MS + PLATFORM_WRITE_TIMEOUT_MS;
  const result = await getDb().execute(sql`
    select (${claimedAt}::timestamptz + (${quietMs}::int * interval '1 millisecond')) <= now() as quiet
  `);
  const quiet = (result.rows[0] as { quiet?: boolean | string } | undefined)?.quiet;
  return quiet === true || quiet === "t" || quiet === "true";
}

/**
 * True when this pause target is not paused on the platform.
 * Mock accounts use the local row for that external id. A real token never does,
 * including when this process is not configured or sync.live is off.
 * A missing read stays unknown. Other ads on the account are not consulted.
 */
async function pauseNotLanded(
  adAccountId: string,
  workspaceId: string,
  mutation: ReturnType<typeof parseApplyMutations>[number],
): Promise<boolean | null> {
  const tokens = await loadTokens(adAccountId);
  if (!tokens) return null;
  const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  const flags = resolveWorkspaceCapabilities(workspace?.settingsJson ?? {});
  const connector = getAdPlatformConnector(mutation.platform);
  if (!isMockToken(tokens)) {
    if (!connector.isLiveAllowed(tokens, flags)) return null;
    const live = await connector.readLiveEntityState({ tokens, mutation }).catch(() => null);
    if (!live?.status) return null;
    return live.status.toLowerCase() !== "paused";
  }
  const entity = await getDb().query.adEntities.findFirst({
    where: and(eq(adEntities.adAccountId, adAccountId), eq(adEntities.externalId, mutation.target.externalId)),
  });
  if (!entity) return null;
  return entity.status.toLowerCase() !== "paused";
}

/**
 * One conditional update owns the job. Only queued or pending can become applying.
 * That update, the database-clock claimedAt, and the apply_attempt client-audit row commit together.
 * A failed attempt rolls the claim back to queued.
 * A second caller, including inline apply, sees applying and does not call the platform.
 * A claim older than the lease is marked failed and is not sent to the platform again.
 * The checks below commit before any platform I/O.
 */
async function claimApplyJob(
  applyJobId: string,
): Promise<{ kind: "done"; result: ApplyRunResult } | { kind: "run"; prepared: PreparedApply }> {
  const claimed = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(applyJobs)
      .set({
        status: "applying",
        attempts: sql`${applyJobs.attempts} + 1`,
        error: null,
        responseJson: sql`jsonb_build_object('claimedAt', now(), 'claimToken', gen_random_uuid()::text)`,
      })
      .where(and(eq(applyJobs.id, applyJobId), inArray(applyJobs.status, ["queued", "pending"])))
      .returning();

    if (!row) {
      const existing = await tx.query.applyJobs.findFirst({ where: eq(applyJobs.id, applyJobId) });
      if (!existing) throw new Error("Apply job not found");
      return { kind: "absent" as const, existing };
    }

    const handle = tx as unknown as ApplyHandle;
    const job = row;

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
    const account = recommendation?.adAccountId
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
          {
            blocked: "authorization_revoked",
            clientAudit: { kind: "apply_blocked", recommendation: recommendation ?? null },
          },
        ),
      };
    }

    const gate = evaluateApplyGate({
      expectedWorkspaceId: job.workspaceId,
      workspace,
      authorization,
      account,
      recommendationScope: recommendation?.scope,
    });
    if (!gate.allowed) {
      const response = { ...gate, outcomes: [], writes: false };
      return {
        kind: "done" as const,
        result: await saveJob(
          handle,
          job,
          { status: "failed", error: gate.blocked, response },
          {
            blocked: gate.blocked,
            clientAudit: { kind: "apply_blocked", recommendation: recommendation ?? null },
          },
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

    await writeApplyClientAudit(handle, {
      kind: "apply_attempt",
      recommendation,
      jobId: job.id,
      status: "applying",
      writes: false,
      blocked: null,
      error: null,
      outcomes: [],
      response: { claimedAt: (job.responseJson as { claimedAt?: string } | null)?.claimedAt ?? null },
    });

    return {
      kind: "run" as const,
      prepared: { job, recommendation, account, capabilities, jobType },
    };
  });

  if (claimed.kind === "absent") {
    const existing = claimed.existing;
    if (existing.status === "applying") {
      if (await applyingLeaseExpired(existing.responseJson)) {
        return { kind: "done" as const, result: await closeStaleApplying(existing) };
      }
      return { kind: "done" as const, result: storedRun(existing, "in_progress") };
    }
    return { kind: "done" as const, result: storedRun(existing) };
  }
  return claimed;
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
      { blocked: "capability_apply", clientAudit: { kind: "apply_blocked", recommendation } },
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
      { blocked: row.blocked, clientAudit: { kind: "apply_blocked", recommendation } },
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
      { blocked: "create_entity_sealed", clientAudit: { kind: "apply_blocked", recommendation } },
    );
  }
  return null;
}

function skippedDeadline(mutation: { action: MutationOutcome["action"]; platform: MutationOutcome["platform"]; target: MutationOutcome["target"] }): MutationOutcome {
  return {
    action: mutation.action,
    platform: mutation.platform,
    target: mutation.target,
    status: "skipped",
    mode: "mock",
    writes: false,
    reason: "apply_deadline",
  };
}

async function executePrepared(prepared: PreparedApply): Promise<{
  outcomes: MutationOutcome[];
  failed: string | null;
  response: Record<string, unknown>;
  claimToken: string | null;
}> {
  const mutations = parseApplyMutations(prepared.recommendation.proposedMutationsJson);
  const outcomes: MutationOutcome[] = [];
  let failed: string | null = null;
  // The loop clock is the claim, not execute start. A late start must not run past the lease.
  // One call budget is held back so a call that starts inside the window still ends before the lease.
  const remainingMs = await applyingLeaseRemainingMs(prepared.job.responseJson);
  const deadlineAt = applyExecuteDeadlineAt(remainingMs);
  const claimToken = claimTokenOf(prepared.job.responseJson);
  for (const mutation of mutations) {
    if (platformCallBudgetMs(deadlineAt) <= 0) {
      outcomes.push(skippedDeadline(mutation));
      failed = "apply_deadline";
      break;
    }
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
      if (applyClaimHooks.beforeWrite) {
        await applyClaimHooks.beforeWrite({ jobId: prepared.job.id, claimToken });
      }
      // Residual window: this read and the platform HTTP call are not one transaction.
      // A request Meta or Google already accepted cannot be recalled. settleApplyJob
      // writes an audit row when that late write finds the claim gone.
      if (!(await claimStillHeld(prepared.job.id, claimToken))) {
        outcomes.push({
          action: mutation.action,
          platform: mutation.platform,
          target: mutation.target,
          status: "skipped",
          mode: "mock",
          writes: false,
          reason: "claim_lost",
        });
        failed = "claim_lost";
        break;
      }
      if (platformCallBudgetMs(deadlineAt) <= 0) {
        outcomes.push(skippedDeadline(mutation));
        failed = "apply_deadline";
        break;
      }
      const outcome = await executeMutation({
        adAccountId: prepared.account.id,
        platform: prepared.account.platform,
        accountExternalId: prepared.account.externalId,
        mutation,
        capabilities: prepared.capabilities,
        deadlineAt,
      });
      outcomes.push(outcome);
      if (applyClaimHooks.afterWrite) {
        await applyClaimHooks.afterWrite({ jobId: prepared.job.id, claimToken });
      }
      if (outcome.status === "failed") {
        const reason = sanitizeStoredError(outcome.reason ?? `${outcome.action} failed`);
        outcome.reason = reason ?? undefined;
        failed = reason;
        break;
      }
    } catch (error) {
      if (error instanceof ApplyCallBudgetError) {
        outcomes.push(skippedDeadline(mutation));
        failed = "apply_deadline";
        break;
      }
      const unconfirmed = isUnconfirmedApplyError(error);
      const message = unconfirmed
        ? "unconfirmed_write"
        : (sanitizeStoredError(error instanceof Error ? error.message : "Apply mutation failed") ?? "Apply mutation failed");
      outcomes.push({
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "failed",
        mode: "live",
        writes: unconfirmed ? "unknown" : false,
        reason: message,
      });
      failed = message;
      break;
    }
  }
  const recorded = applyOutcomeWrites(outcomes);
  return {
    outcomes,
    failed,
    response: {
      writes: recorded,
      outcomes,
      mode: outcomes.some((row) => row.mode === "live") ? "live" : "mock",
      createNewSkipped: outcomes
        .filter((row) => row.status === "skipped" && /create-new|Create-new/i.test(row.reason ?? ""))
        .map((row) => row.action),
      jobType: prepared.jobType,
    },
    claimToken,
  };
}

async function settleApplyJob(
  jobId: string,
  executed: {
    outcomes: MutationOutcome[];
    failed: string | null;
    response: Record<string, unknown>;
    claimToken: string | null;
  },
): Promise<ApplyRunResult> {
  const settled = await getDb().transaction(async (tx) => {
    const handle = tx as unknown as ApplyHandle;
    const [job] = await tx.select().from(applyJobs).where(eq(applyJobs.id, jobId)).for("update");
    if (!job) throw new Error("Apply job not found");
    const token = claimTokenOf(job.responseJson);
    const sameClaim = executed.claimToken == null ? token == null : token === executed.claimToken;
    const supersededClose =
      job.status === "failed" &&
      (job.error === "stale_applying" ||
        (job.responseJson as { blocked?: unknown } | null)?.blocked === "stale_applying");
    const claimLost = !(job.status === "applying" && sameClaim) && !supersededClose;
    if (claimLost) {
      const recorded = applyOutcomeWrites(executed.outcomes);
      const sent = recorded === true || recorded === "unknown";
      if (sent) {
        await handle.insert(auditLog).values({
          workspaceId: job.workspaceId,
          actorType: "worker",
          actorId: null,
          action: recorded === true ? "apply_success" : "apply_fail",
          entityType: "apply_job",
          entityId: job.id,
          payloadJson: {
            authorizationId: job.authorizationId,
            writes: recorded,
            outcomes: executed.outcomes,
            superseded: "claim_lost",
          },
        });
      }
      return {
        result: {
          ...storedRun(job, job.status === "applying" ? "in_progress" : null),
          audited: sent,
          replayed: true,
        },
        clientAudit: null,
      };
    }
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
    const supersededStale =
      job.error === "stale_applying" ||
      (job.responseJson as { blocked?: unknown } | null)?.blocked === "stale_applying";
    const freshAuth = await handle.query.authorizations.findFirst({
      where: eq(authorizations.id, job.authorizationId),
    });
    const recommendation = freshAuth
      ? await handle.query.recommendations.findFirst({
          where: eq(recommendations.id, freshAuth.recommendationId),
        })
      : null;
    if (!authorizationStillApplies(job, freshAuth, recommendation)) {
      const recorded = applyOutcomeWrites(executed.outcomes);
      const writes = recorded === true;
      const settled = settledApplyJob({ writes, failed: executed.failed, revoked: true });
      const response = {
        ...executed.response,
        writes: recorded,
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
          writes: recorded,
          outcomes: executed.outcomes,
          revokedDuringApply: true,
          revoked_after_write: writes,
        },
      });
      const saved = await saveJob(
        handle,
        job,
        {
          status: settled.status,
          error: settled.error,
          response,
          finished: true,
        },
        {
          outcomes: executed.outcomes,
          writes,
          blocked: writes ? "revoked_after_write" : "authorization_revoked",
          locked: true,
        },
      );
      return {
        result: { ...saved, audited: true },
        clientAudit: recommendation
          ? {
              kind: (writes ? "applied" : "apply_blocked") as "applied" | "apply_blocked",
              recommendation,
              status: settled.status,
              writes,
              blocked: writes ? "revoked_after_write" : "authorization_revoked",
              error: settled.error,
              response,
            }
          : null,
      };
    }
    const recorded = applyOutcomeWrites(executed.outcomes);
    const writes = recorded === true;
    const settled = settledApplyJob({ writes, failed: executed.failed, revoked: false });
    if (supersededStale) {
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
          writes: recorded,
          outcomes: executed.outcomes,
          superseded: "stale_applying",
        },
      });
    }
    const saved = await saveJob(
      handle,
      job,
      {
        status: settled.status,
        error: settled.error,
        response: { ...executed.response, writes: recorded, outcomes: executed.outcomes },
        finished: true,
      },
      { outcomes: executed.outcomes, writes, blocked: null, locked: true },
    );
    return {
      result: supersededStale ? { ...saved, audited: true } : saved,
      clientAudit: recommendation
        ? {
            kind: (writes ? "applied" : "apply_blocked") as "applied" | "apply_blocked",
            recommendation,
            status: settled.status,
            writes,
            blocked: null as string | null,
            error: settled.error,
            response: { ...executed.response, writes, outcomes: executed.outcomes },
          }
        : null,
    };
  });
  // The job row already records the platform outcome. The client-audit insert is next, and a
  // failure here must stay loud without rolling the job back to applying.
  if (settled.clientAudit) {
    await writeApplyClientAudit(getDb() as unknown as ApplyHandle, {
      kind: settled.clientAudit.kind,
      recommendation: settled.clientAudit.recommendation,
      jobId,
      status: settled.clientAudit.status,
      writes: settled.clientAudit.writes,
      blocked: settled.clientAudit.blocked,
      error: settled.clientAudit.error,
      outcomes: executed.outcomes,
      response: settled.clientAudit.response,
    });
  }
  return settled.result;
}

export async function runApplyJob(applyJobId: string): Promise<ApplyRunResult> {
  const claimed = await claimApplyJob(applyJobId);
  if (claimed.kind === "done") return claimed.result;
  const executed = await executePrepared(claimed.prepared);
  return settleApplyJob(claimed.prepared.job.id, executed);
}
