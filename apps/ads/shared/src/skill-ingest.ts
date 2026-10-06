/**
 * Store ingested skill recommendations on os.recommendations.
 * Extra format fields live in evidence_json.skillRec. No new columns.
 */
import { DEDUPE_WINDOW_MS, SKILL_REC_KEY, type ExistingSkillRec, type IngestAccept, type PreparedSkillRec } from "@cerevex/skills";
import { and, eq, gte } from "drizzle-orm";
import { getDb, type Database } from "./db";
import { recordRecLifecycle } from "./rec-lifecycle";
import { insertScopedRecommendation } from "./scoped-recommendations";
import { recommendations } from "./schema";
import { SKILL_REC_EVIDENCE_KEY, readSkillRec } from "./skill-rec-view";

export interface StoredSkillRec {
  id: string;
  merged: boolean;
  externalId: string;
  group: PreparedSkillRec["evidence"]["group"];
  sources: string[];
}

export async function loadRecentSkillRecs(
  clientId: string,
  now: Date,
  db: Database = getDb(),
): Promise<ExistingSkillRec[]> {
  const since = new Date(now.getTime() - DEDUPE_WINDOW_MS);
  const rows = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.clientId, clientId), gte(recommendations.createdAt, since)));
  const existing: ExistingSkillRec[] = [];
  for (const row of rows) {
    const view = readSkillRec(row.evidenceJson);
    if (!view?.dedupeKey) continue;
    const evidence = skillEvidence(row.evidenceJson);
    if (!evidence) continue;
    existing.push({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      prepared: preparedFromRow(row, evidence),
    });
  }
  return existing;
}

export async function storeIngestedSkillRecs(
  input: {
    workspaceId: string;
    clientId: string;
    accepts: IngestAccept[];
    actorType: string;
    actorId?: string | null;
  },
  db: Database = getDb(),
): Promise<StoredSkillRec[]> {
  const stored: StoredSkillRec[] = [];
  for (const accept of input.accepts) {
    if (accept.mergeIntoId) {
      stored.push(await mergeSkillRec(input, accept.mergeIntoId, accept.prepared, db));
    } else {
      stored.push(await insertSkillRec(input, accept.prepared, db));
    }
  }
  return stored;
}

async function insertSkillRec(
  input: { workspaceId: string; clientId: string; actorType: string; actorId?: string | null },
  prepared: PreparedSkillRec,
  db: Database,
): Promise<StoredSkillRec> {
  const inserted = await insertScopedRecommendation(
    {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      scope: prepared.scope,
      storeId: prepared.storeId,
      type: prepared.evidence.skill,
      title: prepared.title,
      rationale: prepared.rationale,
      estimatedImpactUsd: prepared.estimatedImpactUsd,
      risk: prepared.risk,
      confidence: prepared.confidence,
      evidence: { [SKILL_REC_KEY]: prepared.evidence },
      proposedMutations: [],
      source: prepared.evidence.sources.at(-1) ?? prepared.evidence.source,
      module: prepared.evidence.skill,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
    },
    db,
  );
  return summary(inserted.id, false, prepared);
}

async function mergeSkillRec(
  input: { workspaceId: string; clientId: string; actorType: string; actorId?: string | null },
  id: string,
  prepared: PreparedSkillRec,
  db: Database,
): Promise<StoredSkillRec> {
  const [row] = await db.select().from(recommendations).where(eq(recommendations.id, id)).limit(1);
  if (!row || row.clientId !== input.clientId || row.workspaceId !== input.workspaceId) {
    throw new Error("Dedupe target is not on this client");
  }
  const prior = isRecord(row.evidenceJson) ? row.evidenceJson : {};
  await db
    .update(recommendations)
    .set({
      title: prepared.title,
      rationale: prepared.rationale,
      estimatedImpactUsd: prepared.estimatedImpactUsd,
      risk: prepared.risk,
      confidence: prepared.confidence,
      evidenceJson: { ...prior, [SKILL_REC_EVIDENCE_KEY]: prepared.evidence },
    })
    .where(eq(recommendations.id, id));
  await recordRecLifecycle(
    {
      kind: "rec_created",
      recommendationId: id,
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      storeId: prepared.storeId,
      module: prepared.evidence.skill,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      entityType: "recommendation",
      entityId: id,
      source: prepared.evidence.sources.at(-1) ?? prepared.evidence.source,
      payload: {
        merged: true,
        sources: prepared.evidence.sources,
        externalId: prepared.evidence.externalId,
        versions: prepared.evidence.versions,
      },
    },
    db,
  );
  return summary(id, true, prepared);
}

function summary(id: string, merged: boolean, prepared: PreparedSkillRec): StoredSkillRec {
  return {
    id,
    merged,
    externalId: prepared.evidence.externalId,
    group: prepared.evidence.group,
    sources: prepared.evidence.sources,
  };
}

function skillEvidence(value: unknown): PreparedSkillRec["evidence"] | null {
  if (!isRecord(value) || !isRecord(value[SKILL_REC_EVIDENCE_KEY])) return null;
  return value[SKILL_REC_EVIDENCE_KEY] as unknown as PreparedSkillRec["evidence"];
}

function preparedFromRow(
  row: typeof recommendations.$inferSelect,
  evidence: PreparedSkillRec["evidence"],
): PreparedSkillRec {
  const namedStore = row.scope === "store";
  return {
    record: {
      id: evidence.externalId,
      format: evidence.format === "1.0" ? "1.0" : "1.1",
      client: "",
      scope: namedStore ? "store" : "client",
      store: evidence.store,
      source: evidence.source,
      versions: evidence.versions,
      target: evidence.target ?? undefined,
      dedupe_key: evidence.dedupeKey,
      skill: evidence.skill,
      channel: evidence.channel,
      group: evidence.group,
      finding: row.title,
      why_plain: evidence.whyPlain ?? undefined,
      change: evidence.change ?? undefined,
      rollback: evidence.rollback ?? undefined,
      requires: evidence.requires,
      capacity_check: evidence.capacityCheck ?? undefined,
      claims_check: evidence.claimsCheck,
      baseline: evidence.baseline ?? undefined,
      expected_delta: evidence.expectedDelta ?? undefined,
      expected_monthly_dollars: evidence.expectedMonthly
        ? {
            low: evidence.expectedMonthly.low ?? undefined,
            high: evidence.expectedMonthly.high ?? undefined,
          }
        : undefined,
      approval: {
        status: "PENDING_APPROVAL",
        approved_by: null,
        approved_at: null,
        executed_by: null,
        executed_at: null,
        apply_result: null,
        rolled_back_by: null,
        rolled_back_at: null,
      },
    },
    evidence,
    title: row.title,
    rationale: row.rationale,
    estimatedImpactUsd: row.estimatedImpactUsd == null ? null : String(row.estimatedImpactUsd),
    confidence: row.confidence == null ? null : String(row.confidence),
    risk: row.risk === "low" || row.risk === "high" ? row.risk : "medium",
    scope: namedStore ? "store" : "client",
    storeId: row.storeId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
