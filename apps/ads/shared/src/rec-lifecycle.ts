/**
 * One helper for the format 1.1 approval block and the append-only client audit log.
 * Approve, decide, apply, mark-done, rollback, prompt-layer, and role changes
 * all come through here. Jobs and skills cannot set approved.
 */

import { sealSkillJobApproval, type RecommendationApproval } from "@cerevex/skills";
import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import { redactSecrets } from "./crypto";
import { getDb, type Database } from "./db";
import {
  clientAuditLog,
  clients,
  memberships,
  recommendations,
  users,
} from "./schema";
import type { RecommendationDraft } from "./audit-schemas";
import type { Role } from "./types";

export const CLIENT_AUDIT_ACTIONS = [
  "rec_created",
  "approved",
  "rejected",
  "applied",
  "apply_attempt",
  "apply_blocked",
  "approve_refused",
  "mark_done",
  "rolled_back",
  "prompt_layer_approved",
  "prompt_layer_rolled_back",
  "role_changed",
] as const;

/** Person decisions. The internal service key cannot write these. */
export const SERVICE_REFUSED_LIFECYCLE_KINDS = [
  "approved",
  "rejected",
  "mark_done",
  "rolled_back",
  "prompt_layer_approved",
  "prompt_layer_rolled_back",
] as const;

export function servicePrincipalRefused(principal: string | undefined, kind: string): boolean {
  return principal === "service" && (SERVICE_REFUSED_LIFECYCLE_KINDS as readonly string[]).includes(kind);
}

export type ClientAuditAction = (typeof CLIENT_AUDIT_ACTIONS)[number];

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 100;
export const AUDIT_EXPORT_CAP = 2000;

const SECRET_KEY = /token|secret|password|authorization|api[_-]?key|credential/i;
const SECRET_TEXT = /(?:bearer\s+\S+|ya29\.[A-Za-z0-9._-]+|EAA[A-Za-z0-9]{20,})/i;
const EMAIL_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;
const OBFUSCATED_EMAIL = /[A-Za-z0-9._%+-]+\s*\[at\]\s*[A-Za-z0-9.-]+\s*\[dot\]\s*[A-Za-z]{2,}/gi;
const INTL_PHONE = /\+\d{1,3}(?:[\s.-]*\d){8,14}/g;
const US_PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/g;
const COMPACT_PHONE = /(?<!\d)\d{10}(?!\d)/g;

export type ClientAuditRow = {
  id: string;
  workspaceId: string;
  clientId: string;
  storeId: string | null;
  actorType: string;
  actorId: string | null;
  approver: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AuditListQuery = {
  clientId: string;
  storeId?: string | null;
  from?: string | null;
  to?: string | null;
  approver?: string | null;
  module?: string | null;
  action?: string | null;
  limit?: number;
  cursor?: string | null;
};

export type AuditListResult = {
  rows: ClientAuditRow[];
  nextCursor: string | null;
  truncated: boolean;
  limit: number;
};

type LifecycleBase = {
  workspaceId: string;
  clientId: string;
  storeId?: string | null;
  module: string;
  actorType: string;
  actorId?: string | null;
  approver?: string | null;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

export type RecLifecycleInput =
  | (LifecycleBase & { kind: "rec_created"; source: string; recommendationId: string })
  | (LifecycleBase & { kind: "approved" | "rejected"; recommendationId: string; at?: string })
  | (LifecycleBase & {
      kind: "applied" | "apply_attempt" | "apply_blocked";
      recommendationId: string;
      applyResult: string;
      before: unknown;
      after: unknown;
      at?: string;
    })
  | (LifecycleBase & { kind: "approve_refused"; recommendationId: string; at?: string })
  | (LifecycleBase & { kind: "mark_done"; recommendationId: string; at?: string })
  | (LifecycleBase & { kind: "rolled_back"; recommendationId: string; at?: string })
  | (LifecycleBase & {
      kind: "prompt_layer_approved" | "prompt_layer_rolled_back";
      version: string;
    })
  | (LifecycleBase & {
      kind: "role_changed";
      userId: string;
      fromRole: string | null;
      toRole: string;
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Existing scrubber, then drop any other secret-shaped key or bearer string. */
export function redactAuditValue<T>(value: T): T {
  return stripSecrets(redactSecrets(value)) as T;
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : stripSecrets(inner);
    }
    return out;
  }
  if (typeof value === "string") return scrubFreeText(value);
  return value;
}

/** Secret-shaped strings, then emails and phone numbers in free text such as notes. */
function scrubFreeText(value: string): string {
  if (SECRET_TEXT.test(value)) return "[redacted]";
  for (const pattern of [OBFUSCATED_EMAIL, EMAIL_TEXT, INTL_PHONE, US_PHONE, COMPACT_PHONE]) {
    pattern.lastIndex = 0;
  }
  return value
    .replace(OBFUSCATED_EMAIL, "[redacted]")
    .replace(EMAIL_TEXT, "[redacted]")
    .replace(INTL_PHONE, "[redacted]")
    .replace(US_PHONE, "[redacted]")
    .replace(COMPACT_PHONE, "[redacted]");
}

export function readApproval(value: unknown): RecommendationApproval {
  const row = isRecord(value) ? value : {};
  const status = row.status;
  return {
    status: status === "approved" || status === "rejected" ? status : "PENDING_APPROVAL",
    approved_by: typeof row.approved_by === "string" ? row.approved_by : null,
    approved_at: typeof row.approved_at === "string" ? row.approved_at : null,
    executed_by: row.executed_by === "cerevex_apply" || row.executed_by === "human" ? row.executed_by : null,
    executed_at: typeof row.executed_at === "string" ? row.executed_at : null,
    apply_result: typeof row.apply_result === "string" ? row.apply_result : null,
    rolled_back_by: typeof row.rolled_back_by === "string" ? row.rolled_back_by : null,
    rolled_back_at: typeof row.rolled_back_at === "string" ? row.rolled_back_at : null,
  };
}

function toPublic(row: typeof clientAuditLog.$inferSelect): ClientAuditRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    storeId: row.storeId,
    actorType: row.actorType,
    actorId: row.actorId,
    approver: row.approver,
    module: row.module,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    payload: (row.payloadJson as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

async function storeIdFor(db: Database, clientId: string, explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  return client?.siteId ?? null;
}

async function approverName(db: Database, actorId: string | null | undefined, fallback?: string | null) {
  if (fallback) return fallback;
  if (!actorId) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, actorId) });
  return user?.name ?? null;
}

export async function recordRecLifecycle(input: RecLifecycleInput, db: Database = getDb()): Promise<ClientAuditRow> {
  return db.transaction(async (tx) => recordRecLifecycleOn(input, tx as unknown as Database));
}

async function recordRecLifecycleOn(input: RecLifecycleInput, db: Database): Promise<ClientAuditRow> {
  const at = "at" in input && input.at ? input.at : new Date().toISOString();
  const storeId = await storeIdFor(db, input.clientId, input.storeId);
  const approver = await approverName(db, input.actorId, input.approver);

  const recommendationId = recommendationIdOf(input);
  if (recommendationId && touchesApproval(input.kind)) {
    const rec = await db.query.recommendations.findFirst({
      where: eq(recommendations.id, recommendationId),
    });
    if (!rec) throw new Error("Recommendation not found");
    const approval = readApproval(rec.approvalJson);
    if (input.kind === "approved" || input.kind === "rejected") {
      approval.status = input.kind === "approved" ? "approved" : "rejected";
      approval.approved_by = approver;
      approval.approved_at = at;
    }
    if (input.kind === "applied") {
      approval.executed_by = "cerevex_apply";
      approval.executed_at = at;
      approval.apply_result = input.applyResult;
    }
    if (input.kind === "mark_done") {
      approval.executed_by = "human";
      approval.executed_at = at;
      approval.apply_result = "Marked done by a person";
    }
    if (input.kind === "rolled_back") {
      approval.rolled_back_by = approver;
      approval.rolled_back_at = at;
    }
    await db
      .update(recommendations)
      .set({
        approvalJson: approval,
        ...(input.kind === "approved" ? { status: "authorized" } : {}),
        ...(input.kind === "rejected" ? { status: "denied" } : {}),
      })
      .where(eq(recommendations.id, rec.id));
  }

  const payload = redactAuditValue(lifecyclePayload(input, at, approver));
  const [row] = await db
    .insert(clientAuditLog)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      storeId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      approver,
      module: input.module,
      action: input.kind,
      entityType: input.entityType,
      entityId: input.entityId ?? recommendationId,
      payloadJson: payload,
    })
    .returning();
  return toPublic(row);
}

function touchesApproval(kind: RecLifecycleInput["kind"]): boolean {
  return kind === "approved" || kind === "rejected" || kind === "applied" || kind === "mark_done" || kind === "rolled_back";
}

function lifecyclePayload(input: RecLifecycleInput, at: string, approver: string | null): Record<string, unknown> {
  const extra = input.payload ?? {};
  if (input.kind === "rec_created") return { source: input.source, ...extra };
  if (input.kind === "approved" || input.kind === "rejected") {
    return { approver, at, ...extra };
  }
  if (input.kind === "applied" || input.kind === "apply_attempt" || input.kind === "apply_blocked") {
    return {
      ...(input.kind === "applied" ? { executed_by: "cerevex_apply" } : {}),
      apply_result: input.applyResult,
      before: redactAuditValue(input.before),
      after: redactAuditValue(input.after),
      at,
      ...extra,
    };
  }
  if (input.kind === "approve_refused") return { approver, at, ...extra };
  if (input.kind === "mark_done") return { executed_by: "human", at, approver, ...extra };
  if (input.kind === "rolled_back") return { rolled_back_by: approver, at, ...extra };
  if (input.kind === "prompt_layer_approved" || input.kind === "prompt_layer_rolled_back") {
    return { version: input.version, approver, at, ...extra };
  }
  if (input.kind === "role_changed") {
    return {
      userId: input.userId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      approver,
      at,
      ...extra,
    };
  }
  return { approver, at, ...extra };
}

function recommendationIdOf(input: RecLifecycleInput): string | null {
  switch (input.kind) {
    case "rec_created":
    case "approved":
    case "rejected":
    case "applied":
    case "apply_attempt":
    case "apply_blocked":
    case "approve_refused":
    case "mark_done":
    case "rolled_back":
      return input.recommendationId;
    default:
      return null;
  }
}

export async function insertJobRecommendation(
  draft: RecommendationDraft,
  meta: { source: string; module?: string; storeId?: string | null; approval?: unknown },
  db: Database = getDb(),
) {
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    const approval = sealSkillJobApproval(meta.approval);
    const [inserted] = await database
      .insert(recommendations)
      .values({ ...draft, approvalJson: approval })
      .returning();
    await recordRecLifecycle(
      {
        kind: "rec_created",
        recommendationId: inserted.id,
        workspaceId: inserted.workspaceId,
        clientId: inserted.clientId,
        storeId: meta.storeId,
        module: meta.module ?? "ads",
        actorType: "worker",
        entityType: "recommendation",
        entityId: inserted.id,
        source: meta.source,
      },
      database,
    );
    return inserted;
  });
}

export async function setWorkspaceRole(
  input: {
    workspaceId: string;
    userId: string;
    role: Role;
    actorId: string;
  },
  db: Database = getDb(),
): Promise<void> {
  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, input.userId), eq(memberships.workspaceId, input.workspaceId)),
  });
  if (!existing) throw new Error("Membership not found");
  if (existing.role === input.role) return;
  await db.transaction(async (tx) => {
    const database = tx as unknown as Database;
    await database
      .update(memberships)
      .set({ role: input.role })
      .where(and(eq(memberships.userId, input.userId), eq(memberships.workspaceId, input.workspaceId)));
    const clientRows = await database.select().from(clients).where(eq(clients.workspaceId, input.workspaceId));
    for (const client of clientRows) {
      await recordRecLifecycle(
        {
          kind: "role_changed",
          workspaceId: input.workspaceId,
          clientId: client.id,
          storeId: client.siteId,
          module: "roles",
          actorType: "user",
          actorId: input.actorId,
          entityType: "membership",
          entityId: input.userId,
          userId: input.userId,
          fromRole: existing.role,
          toRole: input.role,
        },
        database,
      );
    }
  });
}

export function encodeAuditCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}

export function decodeAuditCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const split = cursor.lastIndexOf("|");
  if (split <= 0) return null;
  const createdAt = new Date(cursor.slice(0, split));
  const id = cursor.slice(split + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

function startOfUtcDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfUtcDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function listClientAuditLog(query: AuditListQuery, db: Database = getDb()): Promise<AuditListResult> {
  const limit = Math.min(Math.max(query.limit ?? AUDIT_PAGE_DEFAULT, 1), AUDIT_PAGE_MAX);
  const filters = auditFilters(query);
  const cursor = decodeAuditCursor(query.cursor);
  if (cursor) {
    filters.push(
      or(
        lt(clientAuditLog.createdAt, cursor.createdAt),
        and(eq(clientAuditLog.createdAt, cursor.createdAt), lt(clientAuditLog.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(clientAuditLog)
    .where(and(...filters))
    .orderBy(desc(clientAuditLog.createdAt), desc(clientAuditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map(toPublic);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > limit && last ? encodeAuditCursor(last.createdAt, last.id) : null,
    truncated: false,
    limit,
  };
}

export async function exportClientAuditLog(
  query: Omit<AuditListQuery, "limit" | "cursor">,
  db: Database = getDb(),
): Promise<{ rows: ClientAuditRow[]; truncated: boolean; limit: number }> {
  const filters = auditFilters(query);
  const rows = await db
    .select()
    .from(clientAuditLog)
    .where(and(...filters))
    .orderBy(desc(clientAuditLog.createdAt), desc(clientAuditLog.id))
    .limit(AUDIT_EXPORT_CAP + 1);
  const truncated = rows.length > AUDIT_EXPORT_CAP;
  return {
    rows: rows.slice(0, AUDIT_EXPORT_CAP).map(toPublic),
    truncated,
    limit: AUDIT_EXPORT_CAP,
  };
}

function auditFilters(query: Omit<AuditListQuery, "limit" | "cursor">) {
  const filters = [eq(clientAuditLog.clientId, query.clientId)];
  if (query.storeId) filters.push(eq(clientAuditLog.storeId, query.storeId));
  if (query.approver) filters.push(eq(clientAuditLog.approver, query.approver));
  if (query.module) filters.push(eq(clientAuditLog.module, query.module));
  if (query.action) filters.push(eq(clientAuditLog.action, query.action));
  const from = query.from ? startOfUtcDay(query.from) : null;
  const to = query.to ? endOfUtcDay(query.to) : null;
  if (from) filters.push(gte(clientAuditLog.createdAt, from));
  if (to) filters.push(lte(clientAuditLog.createdAt, to));
  return filters;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const AUDIT_CSV_HEADER = [
  "created_at",
  "client_id",
  "store_id",
  "approver",
  "module",
  "action",
  "actor_type",
  "entity_type",
  "entity_id",
  "payload",
] as const;

export function clientAuditCsvLine(row: ClientAuditRow): string {
  return [
    row.createdAt,
    row.clientId,
    row.storeId,
    row.approver,
    row.module,
    row.action,
    row.actorType,
    row.entityType,
    row.entityId,
    JSON.stringify(row.payload),
  ]
    .map(csvCell)
    .join(",");
}

export function clientAuditCsv(rows: ClientAuditRow[]): string {
  return [AUDIT_CSV_HEADER.join(","), ...rows.map(clientAuditCsvLine)].join("\n") + "\n";
}

export async function* streamClientAuditCsv(rows: ClientAuditRow[]): AsyncGenerator<string> {
  yield `${AUDIT_CSV_HEADER.join(",")}\n`;
  for (const row of rows) {
    yield `${clientAuditCsvLine(row)}\n`;
  }
}

/** Kept so a raw count query stays available to the export cap test. */
export async function countClientAuditLog(clientId: string, db: Database = getDb()): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from os.client_audit_log where client_id = ${clientId}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
