/**
 * Store one MCP recommendation through the existing scoped-rec insert.
 * The row stays proposed and PENDING_APPROVAL. Nothing here approves or applies it.
 * Idempotency is the identity plus the key, serialized on the client row.
 * A unique key column would be a migration, so this does not add one.
 */
import type { McpRecommendationType } from "@cerevex/contracts";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "./db";
import { insertScopedRecommendation } from "./scoped-recommendations";
import { clients, recommendations } from "./schema";

export class McpRecommendationError extends Error {
  readonly reason: "client_not_found";

  constructor(reason: "client_not_found") {
    super(reason);
    this.name = "McpRecommendationError";
    this.reason = reason;
  }
}

export type PendingMcpRecommendation = {
  outcome: "created" | "duplicate";
  id: string;
  status: string;
  approvalJson: unknown;
  source: string;
};

export async function createPendingMcpRecommendation(
  input: {
    workspaceId: string;
    clientId: string;
    identityId: string;
    identityName: string;
    idempotencyKey: string;
    type: McpRecommendationType;
    title: string;
    rationale: string;
  },
  db: Database = getDb(),
): Promise<PendingMcpRecommendation> {
  const source = `agent:${input.identityName}`;
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    const [locked] = await database
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId)))
      .for("update")
      .limit(1);
    if (!locked) throw new McpRecommendationError("client_not_found");

    const [existing] = await database
      .select({
        id: recommendations.id,
        status: recommendations.status,
        approvalJson: recommendations.approvalJson,
      })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.workspaceId, input.workspaceId),
          eq(recommendations.clientId, input.clientId),
          sql`${recommendations.evidenceJson}->'mcp'->>'idempotencyKey' = ${input.idempotencyKey}`,
          sql`${recommendations.evidenceJson}->'mcp'->>'identityId' = ${input.identityId}`,
        ),
      )
      .limit(1);
    if (existing) {
      return {
        outcome: "duplicate",
        id: existing.id,
        status: existing.status,
        approvalJson: existing.approvalJson,
        source,
      };
    }

    const inserted = await insertScopedRecommendation(
      {
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        scope: "client",
        type: input.type,
        title: input.title,
        rationale: input.rationale,
        risk: "medium",
        evidence: {
          writes: false,
          mcp: {
            idempotencyKey: input.idempotencyKey,
            identityId: input.identityId,
            source,
          },
        },
        proposedMutations: [],
        source,
        module: "mcp",
        actorType: "agent",
        actorId: null,
      },
      database,
    );
    return {
      outcome: "created",
      id: inserted.id,
      status: inserted.status,
      approvalJson: inserted.approvalJson,
      source,
    };
  });
}
