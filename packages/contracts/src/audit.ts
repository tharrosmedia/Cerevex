/**
 * Audit event envelopes.
 *
 * Brain today writes store-scoped rows to its own `events` table (public + pgvector Neon).
 * OS audit events live on the isolated OS Neon schema — do not merge those tables.
 * OS `audit_log` is append-only (insert allowed; update/delete blocked).
 */

export type AuditActorType = "system" | "user" | "agent" | "worker" | "brain";
export type AuditSource = "brain" | "os";

export interface AuditActor {
  type: AuditActorType;
  id: string;
}

export interface AuditScope {
  clientId?: string;
  storeId?: string;
  workspaceId?: string;
}

export interface AuditEventEnvelope {
  id: string;
  occurredAt: string;
  actor: AuditActor;
  action: string;
  scope: AuditScope;
  source: AuditSource;
  payload: Record<string, unknown>;
  jobId?: string;
}

/** Origin OS audit row (workspace-scoped). */
export type AuditEvent = {
  id: string;
  workspaceId: string;
  clientId?: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: string;
};
