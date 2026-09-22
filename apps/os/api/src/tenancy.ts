import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { AuthContext } from "@tharros/shared";
import { canSeeAllClientsInWorkspace, scopedClientIds, workspaceIdsFor } from "@tharros/shared";
import { getDb } from "@tharros/shared/db";
import { clients } from "@tharros/shared/schema";

export class TenancyError extends Error {
  status = 403;
  constructor(message = "Not allowed to access this tenant scope") {
    super(message);
    this.name = "TenancyError";
  }
}

export function requireWorkspaceMembership(ctx: AuthContext, workspaceId: string): void {
  if (!workspaceIdsFor(ctx).includes(workspaceId)) {
    throw new TenancyError("Not a member of this workspace");
  }
}

export async function listVisibleClients(ctx: AuthContext) {
  const db = getDb();
  const workspaceIds = workspaceIdsFor(ctx);
  if (workspaceIds.length === 0 && ctx.clientMemberships.length === 0) {
    return [];
  }

  const wideWorkspaceIds = workspaceIds.filter((id) => canSeeAllClientsInWorkspace(ctx, id));
  const clientIds = scopedClientIds(ctx);

  const clauses: SQL[] = [];
  if (wideWorkspaceIds.length > 0) {
    clauses.push(inArray(clients.workspaceId, wideWorkspaceIds));
  }
  if (clientIds.length > 0) {
    clauses.push(inArray(clients.id, clientIds));
  }
  if (clauses.length === 0) {
    return [];
  }

  return db
    .select()
    .from(clients)
    .where(clauses.length === 1 ? clauses[0] : or(...clauses));
}

export async function getVisibleClient(ctx: AuthContext, clientId: string) {
  const db = getDb();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
  });
  if (!client) return null;

  if (canSeeAllClientsInWorkspace(ctx, client.workspaceId)) {
    return client;
  }
  if (scopedClientIds(ctx).includes(client.id)) {
    return client;
  }
  return null;
}

export function assertSameClientScope(
  ctx: AuthContext,
  resource: { workspaceId: string; clientId: string },
): void {
  if (canSeeAllClientsInWorkspace(ctx, resource.workspaceId)) {
    return;
  }
  if (scopedClientIds(ctx).includes(resource.clientId)) {
    return;
  }
  throw new TenancyError();
}

export { and, eq };
