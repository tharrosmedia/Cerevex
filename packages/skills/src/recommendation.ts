/**
 * Cerevex recommendation format 1.1 (2026-10-03).
 *
 * Lifecycle fields stay inside `approval`, where `executed_by` already lived
 * in format 1.0. That matches the amended shared ref. PR 2's audit log is a
 * separate append-only event stream; it should record transitions of these
 * fields, not relocate them.
 *
 * Absent `format` means 1.0. A 1.0 record is still valid.
 */

export const REC_FORMAT_CURRENT = "1.1" as const;
export const REC_FORMATS = ["1.0", "1.1"] as const;
export type RecFormat = (typeof REC_FORMATS)[number];

export const APPROVAL_STATUSES = ["PENDING_APPROVAL", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const EXECUTED_BY = ["cerevex_apply", "human"] as const;
export type ExecutedBy = (typeof EXECUTED_BY)[number];

export interface RecommendationVersions {
  skill?: string;
  pack?: string;
  layer?: string;
}

export interface RecommendationApproval {
  status: ApprovalStatus;
  approver?: string;
  path?: string;
  approved_by?: string | null;
  approved_at?: string | null;
  executed_by?: ExecutedBy | null;
  executed_at?: string | null;
  apply_result?: string | null;
  rolled_back_by?: string | null;
  rolled_back_at?: string | null;
}

export interface RecommendationRecord {
  id: string;
  format?: RecFormat;
  client: string;
  store?: string;
  source?: string;
  versions?: RecommendationVersions;
  target?: string;
  dedupe_key?: string;
  vertical?: string;
  skill: string;
  channel: string;
  segment?: string;
  group: "do_now" | "test" | "needs_data";
  finding: string;
  evidence?: string[];
  metric?: string;
  outcome_definition?: string;
  baseline?: string | number;
  expected_delta?: { low?: string; high?: string; basis?: string };
  expected_monthly_dollars?: { low?: number; high?: number; basis?: string };
  confidence?: "low" | "medium" | "high";
  confidence_reason?: string;
  effort?: string;
  risk?: string;
  why_plain?: string;
  change?: { from?: string; to?: string };
  rollback?: string;
  requires?: string[];
  capacity_check?: string;
  claims_check?: string;
  kpi_node?: string;
  recheck_date?: string;
  approval: RecommendationApproval;
}

export interface NormalizedRecommendation extends RecommendationRecord {
  format: RecFormat;
  store: string;
  source: string;
  versions: { skill: string; pack: string; layer: string };
}

export class SkillJobApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillJobApprovalError";
  }
}

/** The approval block a job or skill is allowed to write. */
export function pendingApprovalRecord(): RecommendationApproval {
  return {
    status: "PENDING_APPROVAL",
    approved_by: null,
    approved_at: null,
    executed_by: null,
    executed_at: null,
    apply_result: null,
    rolled_back_by: null,
    rolled_back_at: null,
  };
}

/**
 * Job and skill writers may only open a rec at PENDING_APPROVAL.
 * Ingestion of an already-approved record is a separate path (PR 3).
 */
export function sealSkillJobApproval(approval: unknown): RecommendationApproval {
  if (approval == null) return pendingApprovalRecord();
  if (typeof approval !== "object" || Array.isArray(approval)) {
    throw new SkillJobApprovalError("Jobs and skills must pass an approval object or omit it");
  }
  const row = approval as Record<string, unknown>;
  const status = row.status ?? "PENDING_APPROVAL";
  if (status !== "PENDING_APPROVAL") {
    throw new SkillJobApprovalError(
      "Jobs and skills cannot set approval.status. Only a person in Cerevex can approve or reject.",
    );
  }
  const filled = [
    "approved_by",
    "approved_at",
    "executed_by",
    "executed_at",
    "apply_result",
    "rolled_back_by",
    "rolled_back_at",
  ] as const;
  for (const key of filled) {
    if (row[key] != null) {
      throw new SkillJobApprovalError(`Jobs and skills cannot set approval.${key}`);
    }
  }
  return pendingApprovalRecord();
}

export class RecommendationValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "RecommendationValidationError";
    this.issues = issues;
  }
}

const LIFECYCLE_KEYS = [
  "approved_by",
  "approved_at",
  "executed_by",
  "executed_at",
  "apply_result",
  "rolled_back_by",
  "rolled_back_at",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRecommendation(input: unknown): RecommendationRecord {
  const issues: string[] = [];
  if (!isRecord(input)) {
    throw new RecommendationValidationError(["record must be an object"]);
  }
  for (const key of LIFECYCLE_KEYS) {
    if (key in input) {
      issues.push(`${key} belongs inside approval, not at the top level`);
    }
  }
  const format = input.format;
  if (format !== undefined && format !== "1.0" && format !== "1.1") {
    issues.push("format must be 1.0 or 1.1 when present");
  }
  if (typeof input.id !== "string" || input.id.length === 0) issues.push("id is required");
  if (typeof input.client !== "string" || input.client.length === 0) issues.push("client is required");
  if (typeof input.skill !== "string" || input.skill.length === 0) issues.push("skill is required");
  if (typeof input.channel !== "string" || input.channel.length === 0) issues.push("channel is required");
  if (input.group !== "do_now" && input.group !== "test" && input.group !== "needs_data") {
    issues.push("group must be do_now, test, or needs_data");
  }
  if (typeof input.finding !== "string") issues.push("finding is required");
  if (!isRecord(input.approval)) {
    issues.push("approval is required");
  } else {
    const status = input.approval.status;
    if (status !== "PENDING_APPROVAL" && status !== "approved" && status !== "rejected") {
      issues.push("approval.status must be PENDING_APPROVAL, approved, or rejected");
    }
    const executedBy = input.approval.executed_by;
    if (executedBy !== undefined && executedBy !== null && executedBy !== "cerevex_apply" && executedBy !== "human") {
      issues.push("approval.executed_by must be cerevex_apply, human, or null");
    }
  }
  if (format === "1.1") {
    if (typeof input.source !== "string" || input.source.length === 0) {
      issues.push("format 1.1 requires source");
    }
    if (!isRecord(input.versions)) issues.push("format 1.1 requires versions");
    if (typeof input.target !== "string" || input.target.length === 0) issues.push("format 1.1 requires target");
    if (typeof input.dedupe_key !== "string" || input.dedupe_key.length === 0) {
      issues.push("format 1.1 requires dedupe_key");
    }
  }
  if (issues.length > 0) throw new RecommendationValidationError(issues);
  return input as unknown as RecommendationRecord;
}

/** Apply the 1.1 compatibility defaults for fields a 1.0 record omits. */
export function normalizeRecommendation(input: unknown): NormalizedRecommendation {
  const record = validateRecommendation(input);
  const versions = record.versions ?? {};
  return {
    ...record,
    format: record.format ?? "1.0",
    store: record.store ?? "all",
    source: record.source ?? "agent:unknown",
    versions: {
      skill: versions.skill ?? "unknown",
      pack: versions.pack ?? "unknown",
      layer: versions.layer ?? "unknown",
    },
  };
}
