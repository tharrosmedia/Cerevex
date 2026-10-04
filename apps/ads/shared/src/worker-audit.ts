import { resolveAuditActor } from "./actor";
import { getDb } from "./db";
import { auditLog } from "./schema";

export async function writeInngestAudit(input: {
  workspaceId: string;
  actorId?: string;
  action: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const actor = resolveAuditActor(input.actorId === "service" ? "service" : "worker", input.actorId);
  await getDb().insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: input.action,
    entityType: "inngest_event",
    payloadJson: input.payload,
  });
}
