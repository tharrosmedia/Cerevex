/**
 * Phase-1 submit_recommendation arguments.
 * A submitted rec stays pending. There is no apply, approve, or publish field.
 */

export const MCP_SUBMIT_TOOL = "submit_recommendation" as const;

/** Same set as ads RECOMMENDATION_TYPES. The ads test pins the two lists together. */
export const MCP_RECOMMENDATION_TYPES = [
  "review_cpa",
  "improve_ctr",
  "add_creative",
  "expand_keywords",
  "spend_concentration",
  "pause_waste",
  "budget_shift",
  "creative_test",
  "lp_congruence",
  "create_alternative",
  "call_attribution",
  "crm_booked_job",
  "lead_lifecycle",
  "booked_job",
  "lp_intelligence",
  "creative_fatigue",
  "search_negatives",
  "geo_discipline",
  "brand_guardrails",
  "seasonality",
  "weekly_narrative",
  "revert",
] as const;

export type McpRecommendationType = (typeof MCP_RECOMMENDATION_TYPES)[number];

export const MCP_SUBMIT_TITLE_MAX = 200;
export const MCP_SUBMIT_RATIONALE_MAX = 4000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;
const SOURCE = /^agent:[a-z0-9-]{2,40}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/;

const ARGUMENT_KEYS = ["clientId", "idempotencyKey", "type", "title", "rationale"] as const;
const REQUEST_KEYS = ["identityId", ...ARGUMENT_KEYS] as const;

export const MCP_SUBMIT_STATUSES = ["proposed", "authorized", "denied", "snoozed"] as const;
export const MCP_SUBMIT_APPROVAL_STATUSES = ["PENDING_APPROVAL", "approved", "rejected"] as const;
export const MCP_SUBMIT_OUTCOMES = ["created", "duplicate"] as const;

export type McpSubmitStatus = (typeof MCP_SUBMIT_STATUSES)[number];
export type McpSubmitApprovalStatus = (typeof MCP_SUBMIT_APPROVAL_STATUSES)[number];
export type McpSubmitOutcome = (typeof MCP_SUBMIT_OUTCOMES)[number];

export type McpSubmitArguments = {
  clientId: string;
  idempotencyKey: string;
  type: McpRecommendationType;
  title: string;
  rationale: string;
};

export type McpSubmitRequest = McpSubmitArguments & {
  identityId: string;
};

export type McpSubmitRecommendation = {
  id: string;
  outcome: McpSubmitOutcome;
  status: McpSubmitStatus;
  approvalStatus: McpSubmitApprovalStatus;
  source: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000")) return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) return null;
  if (EMAIL.test(trimmed) || PHONE.test(trimmed)) return null;
  return trimmed;
}

function recommendationType(value: unknown): McpRecommendationType | null {
  if (typeof value !== "string") return null;
  return (MCP_RECOMMENDATION_TYPES as readonly string[]).includes(value) ? (value as McpRecommendationType) : null;
}

function argumentsFrom(record: Record<string, unknown>): McpSubmitArguments | null {
  if (typeof record.clientId !== "string" || !UUID.test(record.clientId)) return null;
  if (typeof record.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(record.idempotencyKey)) return null;
  const type = recommendationType(record.type);
  const title = boundedText(record.title, MCP_SUBMIT_TITLE_MAX);
  const rationale = boundedText(record.rationale, MCP_SUBMIT_RATIONALE_MAX);
  if (!type || !title || !rationale) return null;
  return { clientId: record.clientId, idempotencyKey: record.idempotencyKey, type, title, rationale };
}

/** Tool arguments. An extra field, including apply, is refused. */
export function parseMcpSubmitArguments(value: unknown): McpSubmitArguments | null {
  if (!isRecord(value) || !exactKeys(value, ARGUMENT_KEYS)) return null;
  return argumentsFrom(value);
}

/** Ads façade body. identityId is added by the connector, never by the tool caller. */
export function parseMcpSubmitRequest(value: unknown): McpSubmitRequest | null {
  if (!isRecord(value) || !exactKeys(value, REQUEST_KEYS)) return null;
  if (typeof value.identityId !== "string" || !UUID.test(value.identityId)) return null;
  const args = argumentsFrom(value);
  return args ? { identityId: value.identityId, ...args } : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Keep only the queue fields. A created rec must still be pending.
 * Extra fields on the ads payload are dropped.
 */
export function projectMcpSubmitRecommendation(value: unknown): McpSubmitRecommendation | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !UUID.test(value.id)) return null;
  const outcome = oneOf(value.outcome, MCP_SUBMIT_OUTCOMES);
  const status = oneOf(value.status, MCP_SUBMIT_STATUSES);
  const approvalStatus = oneOf(value.approvalStatus, MCP_SUBMIT_APPROVAL_STATUSES);
  if (!outcome || !status || !approvalStatus) return null;
  if (typeof value.source !== "string" || !SOURCE.test(value.source)) return null;
  if (outcome === "created" && (status !== "proposed" || approvalStatus !== "PENDING_APPROVAL")) return null;
  return { id: value.id, outcome, status, approvalStatus, source: value.source };
}
