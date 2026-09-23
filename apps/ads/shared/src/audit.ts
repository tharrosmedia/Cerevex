import { isCapabilityVisible } from "@cerevex/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { loadFunnelSignal } from "./analytics";
import { evaluateAccount } from "./audit-engine";
import { evaluateClientM51 } from "./m51-engine";
import { auditRunSummarySchema, parseFindingDraft, parseRecommendationDraft } from "./audit-schemas";
import { readWorkspaceCapabilities } from "./capabilities";
import type { CallRecord } from "./attribution";
import { readConnectorSettings, resolveCallTrackingForClient } from "./connector-settings";
import { getDb } from "./db";
import { applyJobIdempotencyKey, toApplyJobPublic } from "./apply";
import { inferApplyJobType } from "./mutation-families";
import {
  adAccounts,
  adEntities,
  adMetrics,
  applyJobs,
  auditLog,
  auditRuns,
  authorizations,
  decisions,
  findings,
  recommendations,
  workspaces,
} from "./schema";
import {
  EVENTS,
  type ApplyJobPublic,
  type AuditRequestedPayload,
  type AuditRunPublic,
  type AuthorizationPublic,
  type DecisionAction,
  type FindingPublic,
  type RecommendationPublic,
} from "./types";

export type AuditBundle = {
  audit: AuditRunPublic;
  findings: FindingPublic[];
  recommendations: RecommendationPublic[];
};

export function toAuditRunPublic(row: typeof auditRuns.$inferSelect): AuditRunPublic {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    summary: (row.summaryJson as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFindingPublic(row: typeof findings.$inferSelect): FindingPublic {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    auditRunId: row.auditRunId,
    severity: row.severity,
    title: row.title,
    body: (row.bodyJson as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRecommendationPublic(row: typeof recommendations.$inferSelect): RecommendationPublic {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    adAccountId: row.adAccountId,
    type: row.type,
    title: row.title,
    rationale: row.rationale,
    estimatedImpactUsd: row.estimatedImpactUsd == null ? null : String(row.estimatedImpactUsd),
    risk: row.risk,
    confidence: row.confidence == null ? null : String(row.confidence),
    evidence: (row.evidenceJson as Record<string, unknown>) ?? {},
    proposedMutations: (row.proposedMutationsJson as unknown[]) ?? [],
    status: row.status,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAuthorizationPublic(row: typeof authorizations.$inferSelect): AuthorizationPublic {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    recommendationId: row.recommendationId,
    decisionId: row.decisionId,
    scope: (row.scopeJson as Record<string, unknown>) ?? {},
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

export async function createAuditRun(input: {
  workspaceId: string;
  clientId: string;
  requestedBy: string;
  adAccountId?: string;
}): Promise<typeof auditRuns.$inferSelect> {
  const db = getDb();
  const [row] = await db
    .insert(auditRuns)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      status: "queued",
      summaryJson: {
        writes: false,
        adAccountId: input.adAccountId ?? null,
        requestedBy: input.requestedBy,
      },
    })
    .returning();
  await db.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: "user",
    actorId: input.requestedBy,
    action: "jobs.audit_enqueued",
    entityType: "audit_run",
    entityId: row.id,
    payloadJson: {
      event: EVENTS.auditRequested,
      clientId: input.clientId,
      adAccountId: input.adAccountId,
      writes: false,
    },
  });
  return row;
}

export async function runAuditRun(auditRunId: string): Promise<AuditBundle> {
  const db = getDb();
  const run = await db.query.auditRuns.findFirst({
    where: eq(auditRuns.id, auditRunId),
  });
  if (!run) {
    throw new Error("Audit run not found");
  }
  if (run.status === "completed") {
    return getAuditBundle(auditRunId);
  }
  if (!run.clientId) {
    throw new Error("Audit run is missing client_id");
  }

  await db
    .update(auditRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(auditRuns.id, auditRunId));

  try {
    await db.delete(findings).where(eq(findings.auditRunId, auditRunId));
    if (run.clientId) {
      await db
        .delete(recommendations)
        .where(
          and(
            eq(recommendations.clientId, run.clientId),
            sql`${recommendations.evidenceJson} ->> 'auditRunId' = ${auditRunId}`,
          ),
        );
    }

    const requestedAccountId = (run.summaryJson as { adAccountId?: string | null } | null)?.adAccountId;
    const accountRows = await db
      .select()
      .from(adAccounts)
      .where(
        requestedAccountId
          ? and(eq(adAccounts.clientId, run.clientId), eq(adAccounts.id, requestedAccountId))
          : eq(adAccounts.clientId, run.clientId),
      );

    const allFindings = [];
    const allRecommendations = [];
    const ruleIds = new Set<string>();
    const m51Slices = [];

    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, run.workspaceId),
    });
    const flags = readWorkspaceCapabilities(workspace?.settingsJson);
    const connectors = readConnectorSettings(workspace?.settingsJson);
    const tracking = run.clientId
      ? resolveCallTrackingForClient(connectors, run.clientId, flags)
      : { source: null, calls: [] as CallRecord[], callrail: undefined, bundled: undefined, sourceLabel: "CallRail" };
    const crm = run.clientId ? connectors.crm[run.clientId] : undefined;
    const clarity = run.clientId ? connectors.clarity[run.clientId] : undefined;
    const offlineSignals = {
      calls: tracking.calls,
      bookedJobs: crm?.bookedJobs ?? [],
      leads: crm?.leads ?? [],
      callrailEnabled: tracking.source === "callrail",
      bundledEnabled: tracking.source === "bundled",
      sourceLabel: tracking.sourceLabel,
      crmEnabled: isCapabilityVisible("m52.crm_join", flags) && Boolean(crm?.connected),
      leadLifecycleEnabled: isCapabilityVisible("m52.lead_lifecycle", flags) && Boolean(crm?.connected),
      bookedJobSignalEnabled: isCapabilityVisible("m52.booked_job_signal", flags) && Boolean(crm?.connected),
      lpSignals: clarity?.snapshot?.signals ?? [],
      lpIntelligenceEnabled:
        isCapabilityVisible("m52.lp_intelligence", flags) && Boolean(clarity?.connected),
    };

    for (const account of accountRows) {
      const entityRows = await db.select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
      const metricRows = await db.select().from(adMetrics).where(eq(adMetrics.adAccountId, account.id));
      const entities = entityRows.map((row) => ({
        entityType: row.entityType,
        externalId: row.externalId,
        name: row.name,
        status: row.status,
        parentExternalId: row.parentExternalId,
        raw: (row.rawJson as Record<string, unknown>) ?? {},
      }));
      const metrics = metricRows.map((row) => {
        const entity = entityRows.find((item) => item.id === row.entityId);
        return {
          entityExternalId: entity?.externalId ?? row.entityId,
          entityType: entity?.entityType ?? "unknown",
          window: row.window,
          spendUsd: String(row.spendUsd),
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: String(row.conversions),
        };
      });
      const evaluated = evaluateAccount({
        workspaceId: run.workspaceId,
        clientId: run.clientId,
        auditRunId: run.id,
        adAccountId: account.id,
        platform: account.platform,
        offlineSignals,
        entities,
        metrics,
      });
      m51Slices.push({
        adAccountId: account.id,
        platform: account.platform,
        entities,
        metrics,
      });

      for (const draft of evaluated.findings) {
        const parsed = parseFindingDraft(draft);
        ruleIds.add(String(parsed.bodyJson.ruleId));
        const [inserted] = await db.insert(findings).values(parsed).returning();
        allFindings.push(inserted);
      }
      for (const draft of evaluated.recommendations) {
        const parsed = parseRecommendationDraft(draft);
        ruleIds.add(String(parsed.evidenceJson.ruleId));
        const [inserted] = await db.insert(recommendations).values(parsed).returning();
        allRecommendations.push(inserted);
      }
    }

    const funnel = await loadFunnelSignal(run.workspaceId, run.clientId).catch(() => null);
    const m51 = evaluateClientM51({
      workspaceId: run.workspaceId,
      clientId: run.clientId,
      auditRunId: run.id,
      accounts: m51Slices,
      capabilities: flags,
      funnel,
    });
    for (const draft of m51.findings) {
      const parsed = parseFindingDraft(draft);
      ruleIds.add(String(parsed.bodyJson.ruleId));
      const [inserted] = await db.insert(findings).values(parsed).returning();
      allFindings.push(inserted);
    }
    for (const draft of m51.recommendations) {
      const parsed = parseRecommendationDraft(draft);
      ruleIds.add(String(parsed.evidenceJson.ruleId));
      const [inserted] = await db.insert(recommendations).values(parsed).returning();
      allRecommendations.push(inserted);
    }

    if (accountRows.length === 0) {
      const [inserted] = await db
        .insert(findings)
        .values(
          parseFindingDraft({
            workspaceId: run.workspaceId,
            clientId: run.clientId,
            auditRunId: run.id,
            severity: "info",
            title: "No ad accounts in scope",
            bodyJson: {
              ruleId: "no_ad_accounts",
              writes: false,
              hint: "Mock-connect Meta/Google, sync, then re-run the audit.",
            },
          }),
        )
        .returning();
      allFindings.push(inserted);
      ruleIds.add("no_ad_accounts");
    }

    const summary = auditRunSummarySchema.parse({
      writes: false,
      mode: accountRows.some((row) => row.lastSyncAt) || allRecommendations.length > 0 ? "local_tables" : "empty",
      findingCount: allFindings.length,
      recommendationCount: allRecommendations.length,
      accountIds: accountRows.map((row) => row.id),
      ruleIds: [...ruleIds],
      source: "os.ad_entities",
    });

    await db
      .update(auditRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        summaryJson: summary,
      })
      .where(eq(auditRuns.id, auditRunId));

    await db.insert(auditLog).values({
      workspaceId: run.workspaceId,
      actorType: "worker",
      action: "jobs.audit_complete",
      entityType: "audit_run",
      entityId: run.id,
      payloadJson: {
        event: EVENTS.auditRequested,
        clientId: run.clientId,
        ...summary,
      },
    });

    return getAuditBundle(auditRunId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit failed";
    await db
      .update(auditRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        summaryJson: { writes: false, error: message },
      })
      .where(eq(auditRuns.id, auditRunId));
    await db.insert(auditLog).values({
      workspaceId: run.workspaceId,
      actorType: "worker",
      action: "jobs.audit_failed",
      entityType: "audit_run",
      entityId: run.id,
      payloadJson: { event: EVENTS.auditRequested, error: message, writes: false },
    });
    throw error;
  }
}

export async function listAuditRuns(clientId: string): Promise<AuditRunPublic[]> {
  const rows = await getDb()
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.clientId, clientId))
    .orderBy(desc(auditRuns.createdAt))
    .limit(20);
  return rows.map(toAuditRunPublic);
}

export async function listAuditRunsForClients(clientIds: string[], limit = 50): Promise<AuditRunPublic[]> {
  if (clientIds.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(auditRuns)
    .where(inArray(auditRuns.clientId, clientIds))
    .orderBy(desc(auditRuns.createdAt))
    .limit(limit);
  return rows.map(toAuditRunPublic);
}

export async function getAuditBundle(auditRunId: string): Promise<AuditBundle> {
  const db = getDb();
  const run = await db.query.auditRuns.findFirst({
    where: eq(auditRuns.id, auditRunId),
  });
  if (!run) {
    throw new Error("Audit run not found");
  }
  const findingRows = await db.select().from(findings).where(eq(findings.auditRunId, auditRunId));
  const accountIds = ((run.summaryJson as { accountIds?: string[] } | null)?.accountIds ?? []).filter(Boolean);
  const recRows =
    accountIds.length > 0
      ? await db
          .select()
          .from(recommendations)
          .where(
            and(eq(recommendations.clientId, run.clientId ?? ""), inArray(recommendations.adAccountId, accountIds)),
          )
      : run.clientId
        ? await db.select().from(recommendations).where(eq(recommendations.clientId, run.clientId))
        : [];

  const runStarted = run.startedAt?.getTime() ?? run.createdAt.getTime();
  const scopedRecs = recRows.filter((row) => {
    const evidence = row.evidenceJson as { auditRunId?: string } | null;
    if (evidence?.auditRunId) return evidence.auditRunId === auditRunId;
    return row.createdAt.getTime() >= runStarted - 1000;
  });

  return {
    audit: toAuditRunPublic(run),
    findings: findingRows.map(toFindingPublic),
    recommendations: scopedRecs.map(toRecommendationPublic),
  };
}

export async function listRecommendations(clientId: string): Promise<RecommendationPublic[]> {
  const rows = await getDb()
    .select()
    .from(recommendations)
    .where(eq(recommendations.clientId, clientId))
    .orderBy(desc(recommendations.createdAt))
    .limit(50);
  return rows.map(toRecommendationPublic);
}

export async function listRecommendationsForClients(
  clientIds: string[],
  limit = 100,
): Promise<RecommendationPublic[]> {
  if (clientIds.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(recommendations)
    .where(inArray(recommendations.clientId, clientIds))
    .orderBy(desc(recommendations.createdAt))
    .limit(limit);
  return rows.map(toRecommendationPublic);
}

export async function getRecommendation(id: string) {
  return getDb().query.recommendations.findFirst({
    where: eq(recommendations.id, id),
  });
}

export async function getFinding(id: string) {
  return getDb().query.findings.findFirst({
    where: eq(findings.id, id),
  });
}

export async function decideRecommendation(input: {
  recommendationId: string;
  userId: string;
  action: DecisionAction;
  note?: string;
}): Promise<{ recommendation: RecommendationPublic; authorization: AuthorizationPublic | null }> {
  const db = getDb();
  const row = await db.query.recommendations.findFirst({
    where: eq(recommendations.id, input.recommendationId),
  });
  if (!row) {
    throw new Error("Recommendation not found");
  }

  const status =
    input.action === "authorize" ? "authorized" : input.action === "deny" ? "denied" : "snoozed";

  const [decision] = await db
    .insert(decisions)
    .values({
      workspaceId: row.workspaceId,
      clientId: row.clientId,
      recommendationId: row.id,
      userId: input.userId,
      action: input.action,
      note: input.note,
    })
    .returning();

  let authorization: typeof authorizations.$inferSelect | null = null;
  if (input.action === "authorize") {
    [authorization] = await db
      .insert(authorizations)
      .values({
        workspaceId: row.workspaceId,
        clientId: row.clientId,
        recommendationId: row.id,
        decisionId: decision.id,
        scopeJson: {
          kind: "os.authorize-to-apply",
          recommendationId: row.id,
          proposedOnly: false,
          writes: true,
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
  }

  const [updated] = await db
    .update(recommendations)
    .set({ status })
    .where(eq(recommendations.id, row.id))
    .returning();

  await db.insert(auditLog).values({
    workspaceId: row.workspaceId,
    actorType: "user",
    actorId: input.userId,
    action: input.action,
    entityType: "recommendation",
    entityId: row.id,
    payloadJson: {
      action: input.action,
      authorizationId: authorization?.id ?? null,
      writes: false,
      applied: false,
    },
  });

  return {
    recommendation: toRecommendationPublic(updated),
    authorization: authorization ? toAuthorizationPublic(authorization) : null,
  };
}

export async function writeAuditEvent(input: {
  workspaceId: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await getDb().insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    payloadJson: input.payload ?? {},
  });
}

export async function createApplyJobForAuthorization(input: {
  workspaceId: string;
  clientId: string;
  authorizationId: string;
  recommendationId: string;
  proposedMutations: unknown;
  jobType?: "mutate_existing" | "create_entity";
}): Promise<ApplyJobPublic> {
  const db = getDb();
  const key = applyJobIdempotencyKey(input.recommendationId);
  const existing = await db.query.applyJobs.findFirst({
    where: eq(applyJobs.idempotencyKey, key),
  });
  if (existing) {
    return toApplyJobPublic(existing);
  }
  const jobType = input.jobType ?? inferApplyJobType(input.proposedMutations);
  const [job] = await db
    .insert(applyJobs)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      authorizationId: input.authorizationId,
      idempotencyKey: key,
      status: "queued",
      requestJson: {
        recommendationId: input.recommendationId,
        proposedMutations: input.proposedMutations,
        jobType,
      },
    })
    .returning();
  return toApplyJobPublic(job);
}

export async function getWorkspaceKillSwitch(workspaceId: string): Promise<boolean> {
  const workspace = await getDb().query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  return workspace?.applyKillSwitch ?? true;
}

export async function latestAuthorization(recommendationId: string) {
  const rows = await getDb()
    .select()
    .from(authorizations)
    .where(eq(authorizations.recommendationId, recommendationId))
    .orderBy(desc(authorizations.id))
    .limit(1);
  return rows[0] ?? null;
}

export function auditEventPayload(data: AuditRequestedPayload) {
  return data;
}
