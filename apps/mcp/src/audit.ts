/** Workspace security log fields. No free text, tokens, origins, or tool arguments. */
export const AUDIT_REASONS = [
  "origin",
  "method",
  "protocol",
  "headers",
  "kill_switch",
  "unauthenticated",
  "call",
] as const;

export type AuditReason = (typeof AUDIT_REASONS)[number];

export const AUDIT_RESULTS = ["ok", "denied", "error"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export type SecurityAuditEntry = {
  requestId: string;
  result: AuditResult;
  httpStatus: number;
  protocolVersion: string | null;
  method: string | null;
  tool: string | null;
  clientName: string | null;
  clientVersion: string | null;
  latencyMs: number;
  reason: AuditReason;
  identityId: string | null;
  identityName: string | null;
  authType: "unauthenticated" | "agent";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD = /^[a-z][a-z0-9/_-]{0,79}$/;
const TOOL = /^[A-Za-z0-9._:-]{1,80}$/;
const PROTOCOL = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const CLIENT = /^[A-Za-z0-9._+-]{1,64}$/;
const IDENTITY_NAME = /^[a-z0-9-]{2,40}$/;

export function auditToken(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string" || !pattern.test(value)) return null;
  return value;
}

export function clientInfoFrom(value: unknown): { name: string | null; version: string | null } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { name: null, version: null };
  }
  const record = value as Record<string, unknown>;
  return {
    name: auditToken(record.name, CLIENT),
    version: auditToken(record.version, CLIENT),
  };
}

export function buildSecurityAuditEntry(input: {
  requestId: string;
  result: AuditResult;
  httpStatus: number;
  protocolVersion: string | null;
  method: string | null;
  tool: string | null;
  clientName: string | null;
  clientVersion: string | null;
  latencyMs: number;
  reason: AuditReason;
  identity: { id: string; name: string } | null;
}): SecurityAuditEntry {
  const identityId = input.identity ? auditToken(input.identity.id, UUID) : null;
  const identityName = input.identity ? auditToken(input.identity.name, IDENTITY_NAME) : null;
  return {
    requestId: input.requestId,
    result: input.result,
    httpStatus: input.httpStatus,
    protocolVersion: auditToken(input.protocolVersion, PROTOCOL),
    method: auditToken(input.method, METHOD),
    tool: auditToken(input.tool, TOOL),
    clientName: auditToken(input.clientName, CLIENT),
    clientVersion: auditToken(input.clientVersion, CLIENT),
    latencyMs: Math.max(0, Math.min(600_000, Math.floor(input.latencyMs))),
    reason: input.reason,
    identityId,
    identityName,
    authType: input.identity && identityId && identityName ? "agent" : "unauthenticated",
  };
}
