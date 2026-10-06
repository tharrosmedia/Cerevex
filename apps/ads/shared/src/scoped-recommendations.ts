/**
 * Insert a store- or client-scoped recommendation.
 * Skill ingestion calls this for new rows. Dedupe updates an existing row instead.
 */
import { sealSkillJobApproval } from "@cerevex/skills";
import { and, eq, ne } from "drizzle-orm";
import { getDb, type Database } from "./db";
import { recordRecLifecycle } from "./rec-lifecycle";
import { clients, locations, recommendations } from "./schema";

export class ScopedRecommendationError extends Error {
  readonly reason: "client_not_found" | "store_required" | "store_not_allowed" | "store_client_mismatch";

  constructor(reason: ScopedRecommendationError["reason"]) {
    super(reason);
    this.name = "ScopedRecommendationError";
    this.reason = reason;
  }
}

export type ScopedRecommendationInput = {
  workspaceId: string;
  clientId: string;
  scope: "store" | "client";
  /** Brain store id. Required for store scope. Forbidden for client scope. */
  storeId?: string | null;
  type: string;
  title: string;
  rationale: string;
  estimatedImpactUsd?: string | null;
  risk?: string;
  confidence?: string | null;
  evidence?: Record<string, unknown>;
  proposedMutations?: unknown[];
  source: string;
  module?: string;
  actorType?: string;
  actorId?: string | null;
};

function cleanStoreId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function insertScopedRecommendation(
  input: ScopedRecommendationInput,
  db: Database = getDb(),
) {
  const storeId = cleanStoreId(input.storeId);
  if (input.scope === "store" && !storeId) throw new ScopedRecommendationError("store_required");
  if (input.scope === "client" && storeId) throw new ScopedRecommendationError("store_not_allowed");
  if (
    input.type.trim().length === 0 ||
    input.title.trim().length === 0 ||
    input.rationale.trim().length === 0 ||
    input.source.trim().length === 0
  ) {
    throw new Error("type, title, rationale, and source are required");
  }

  return db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    const client = await database.query.clients.findFirst({ where: eq(clients.id, input.clientId) });
    if (!client || client.workspaceId !== input.workspaceId) {
      throw new ScopedRecommendationError("client_not_found");
    }
    if (storeId) {
      const taken = await database
        .select({ clientId: locations.clientId })
        .from(locations)
        .where(and(eq(locations.storeId, storeId), ne(locations.clientId, input.clientId)))
        .limit(1);
      if (taken.length > 0) throw new ScopedRecommendationError("store_client_mismatch");
    }

    const approval = sealSkillJobApproval(undefined);
    const [inserted] = await database
      .insert(recommendations)
      .values({
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        scope: input.scope,
        storeId,
        adAccountId: null,
        type: input.type.trim(),
        title: input.title.trim(),
        rationale: input.rationale.trim(),
        estimatedImpactUsd: input.estimatedImpactUsd ?? null,
        risk: input.risk ?? "medium",
        confidence: input.confidence ?? null,
        evidenceJson: input.evidence ?? {},
        proposedMutationsJson: input.proposedMutations ?? [],
        status: "proposed",
        approvalJson: approval,
        schemaVersion: "1",
      })
      .returning();

    await recordRecLifecycle(
      {
        kind: "rec_created",
        recommendationId: inserted.id,
        workspaceId: inserted.workspaceId,
        clientId: inserted.clientId,
        storeId: inserted.storeId,
        module: input.module ?? "recs",
        actorType: input.actorType ?? "worker",
        actorId: input.actorId ?? null,
        entityType: "recommendation",
        entityId: inserted.id,
        source: input.source.trim(),
      },
      database,
    );
    return inserted;
  });
}
