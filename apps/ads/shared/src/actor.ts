/** Internal-key principal. Never stored in audit_log.actor_id. */
export const SERVICE_ACTOR = "service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Service actions are actor type `service` with a null actor id.
 * A non-uuid actor id is dropped so it cannot be written into audit_log.actor_id.
 */
export function resolveAuditActor(
  actorType: string,
  actorId?: string | null,
): { actorType: string; actorId: string | null } {
  if (actorType === SERVICE_ACTOR || actorId === SERVICE_ACTOR) {
    return { actorType: SERVICE_ACTOR, actorId: null };
  }
  if (!actorId || !UUID_RE.test(actorId)) {
    return { actorType, actorId: null };
  }
  return { actorType, actorId };
}
