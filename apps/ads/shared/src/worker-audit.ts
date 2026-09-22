import { getDb } from "./db";
import { auditLog } from "./schema";

export async function writeInngestAudit(input: {
  workspaceId: string;
  actorId?: string;
  action: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await getDb().insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: "worker",
    actorId: input.actorId,
    action: input.action,
    entityType: "inngest_event",
    payloadJson: input.payload,
  });
}
