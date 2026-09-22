/**
 * Audit event envelope (Plan 1.5).
 *
 * Brain today writes store-scoped rows to its own `events` table (public + pgvector Neon).
 * OS audit events will live on the isolated OS Neon schema — do not merge those tables.
 */

export type AuditActorType = "system" | "user" | "agent";
export type AuditSource = "brain" | "os";

export interface AuditActor {
  type: AuditActorType;
  id: string;
}

/**
 * Scope is either store-scoped (Brain SEO path) or client-scoped (OS).
 * Do not require store_id on OS events; do not require client_id on existing Brain events.
 */
export interface AuditScope {
  clientId?: string;
  storeId?: string;
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
