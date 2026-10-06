/**
 * Validate cerevex-recommendation-format YAML into cockpit-ready records.
 * Invalid records are rejected with a reason. Nothing half-parsed is returned.
 * Guards, gates, and Approve rules match native recs. Slice 1 pilot is HVAC USA.
 */

import { capacityBlocksSpend, runRecGuards, unmetRequires } from "./guards";
import { parseRecommendationYaml, RecommendationYamlError } from "./rec-yaml";
import {
  RecommendationValidationError,
  SkillJobApprovalError,
  normalizeRecommendation,
  pendingApprovalRecord,
  sealSkillJobApproval,
  type NormalizedRecommendation,
  type RecommendationRecord,
} from "./recommendation";

export const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SKILL_REC_KEY = "skillRec";

const MARKETING_SKILLS = new Set(["paid-media", "seo-audit", "seo-research", "account-review-loop"]);
const SOURCE_PATTERN = /^(native|agent):[A-Za-z0-9][A-Za-z0-9._:-]{0,64}$/;
const VERSION_PATTERN = /^[^@\s]+@[^@\s]+$/;

export interface SliceClientGate {
  marketingGate: "on" | "off";
  pilot: boolean;
}

export interface ExistingSkillRec {
  id: string;
  createdAt: string;
  status?: string;
  prepared: PreparedSkillRec;
}

export interface SkillRecEvidence {
  externalId: string;
  format: string;
  group: "do_now" | "test" | "needs_data";
  source: string;
  sources: string[];
  versions: { skill: string; pack: string; layer: string };
  target: string | null;
  dedupeKey: string;
  channel: string;
  skill: string;
  store: string;
  claimsCheck: string;
  noSlop: string;
  capacityCheck: string | null;
  approveHidden: boolean;
  approveHiddenReason: string | null;
  whyPlain: string | null;
  change: { from?: string; to?: string } | null;
  rollback: string | null;
  requires: string[];
  expectedMonthly: { low: number | null; high: number | null } | null;
  baseline: string | number | null;
  expectedDelta: { low?: string; high?: string; basis?: string } | null;
}

export interface PreparedSkillRec {
  record: NormalizedRecommendation;
  evidence: SkillRecEvidence;
  title: string;
  rationale: string;
  estimatedImpactUsd: string | null;
  confidence: string | null;
  risk: "low" | "medium" | "high";
  scope: "store" | "client";
  storeId: string | null;
}

export interface IngestRejection {
  index: number;
  id: string | null;
  reasons: string[];
}

export interface IngestAccept {
  prepared: PreparedSkillRec;
  /** Set when this record merges into a cockpit row already stored. */
  mergeIntoId: string | null;
}

export interface IngestResult {
  accepted: IngestAccept[];
  rejected: IngestRejection[];
}

export interface IngestOptions {
  /** Cockpit client. A record for a different client is rejected. */
  clientSlug: string;
  now?: Date;
  existing?: ExistingSkillRec[];
  clients?: ReadonlyMap<string, SliceClientGate>;
}

const DEFAULT_CLIENTS: ReadonlyMap<string, SliceClientGate> = new Map([
  ["hvac-usa", { marketingGate: "off", pilot: true }],
  ["got-ductless", { marketingGate: "off", pilot: false }],
  ["kc-prestige-hvac", { marketingGate: "off", pilot: false }],
  ["elmar-hvac", { marketingGate: "off", pilot: false }],
  ["tharros-media", { marketingGate: "off", pilot: false }],
  ["cerevex", { marketingGate: "on", pilot: false }],
]);

export function canonicalDedupeKey(record: {
  store: string;
  target?: string | null;
  channel: string;
  change?: { to?: string | null } | null;
}): string {
  const change = (record.change?.to ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${record.store.trim()}|${(record.target ?? "").trim()}|${record.channel.trim()}|${change}`;
}

export function ingestRecommendationYaml(yaml: string, options: IngestOptions): IngestResult {
  let parsed: unknown;
  try {
    parsed = parseRecommendationYaml(yaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : "YAML could not be parsed";
    return { accepted: [], rejected: [{ index: 0, id: null, reasons: [message] }] };
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return ingestRecommendationRecords(records, options);
}

export function ingestRecommendationRecords(records: unknown[], options: IngestOptions): IngestResult {
  const now = options.now ?? new Date();
  const clients = options.clients ?? DEFAULT_CLIENTS;
  const rejected: IngestRejection[] = [];
  const prepared: PreparedSkillRec[] = [];
  const seenIds = new Set<string>();

  records.forEach((input, index) => {
    const id = readId(input);
    try {
      const row = prepareOne(input, options.clientSlug, clients);
      if (seenIds.has(row.evidence.externalId)) {
        rejected.push({ index, id: row.evidence.externalId, reasons: ["duplicate id in this batch"] });
        return;
      }
      seenIds.add(row.evidence.externalId);
      prepared.push(row);
    } catch (error) {
      rejected.push({ index, id, reasons: reasonsOf(error) });
    }
  });

  return { accepted: foldDuplicates(prepared, options.existing ?? [], now), rejected };
}

function prepareOne(
  input: unknown,
  clientSlug: string,
  clients: ReadonlyMap<string, SliceClientGate>,
): PreparedSkillRec {
  const record = normalizeRecommendation(input);
  const issues = collectIssues(record, clientSlug, clients);
  if (issues.length > 0) throw new RecommendationValidationError(issues);
  sealIncomingApproval(record);
  const stored: NormalizedRecommendation = {
    ...record,
    approval: pendingApprovalRecord(),
  };
  const guards = runRecGuards(stored, {
    slug: clientSlug,
    forbidClientNamesAndResults: clientSlug === "tharros-media" || clientSlug === "cerevex",
  });
  const approve = approveRules(stored, guards);
  const dedupeKey = canonicalDedupeKey(stored);
  const evidence: SkillRecEvidence = {
    externalId: stored.id,
    format: stored.format,
    group: approve.group,
    source: stored.source,
    sources: [stored.source],
    versions: stored.versions,
    target: stored.target ?? null,
    dedupeKey,
    channel: stored.channel,
    skill: stored.skill,
    store: stored.store,
    claimsCheck: guards.claimsCheck,
    noSlop: guards.noSlop,
    capacityCheck: stored.capacity_check ?? null,
    approveHidden: approve.approveHidden,
    approveHiddenReason: approve.reason,
    whyPlain: stored.why_plain ?? null,
    change: stored.change ?? null,
    rollback: stored.rollback ?? null,
    requires: stored.requires ?? [],
    expectedMonthly: monthlyRange(stored),
    baseline: stored.baseline ?? null,
    expectedDelta: stored.expected_delta ?? null,
  };
  const namedStore = stored.store !== "all" && stored.store.trim().length > 0;
  return {
    record: stored,
    evidence,
    title: stored.finding.trim(),
    rationale: (stored.why_plain ?? stored.finding).trim(),
    estimatedImpactUsd: impactUsd(stored),
    confidence: confidenceNumber(stored.confidence),
    risk: riskLevel(stored),
    scope: namedStore ? "store" : "client",
    storeId: namedStore ? stored.store : null,
  };
}

function collectIssues(
  record: NormalizedRecommendation,
  clientSlug: string,
  clients: ReadonlyMap<string, SliceClientGate>,
): string[] {
  const issues: string[] = [];
  const gate = clients.get(record.client);
  if (!gate) issues.push(`${record.client} is not an in-scope skill client`);
  if (record.client !== clientSlug) issues.push(`record client ${record.client} does not match ${clientSlug}`);
  if (gate && !gate.pilot) issues.push("Slice 1 pilot is HVAC USA only");
  if (gate?.marketingGate === "on" && MARKETING_SKILLS.has(record.skill)) {
    issues.push("Marketing gate: this client is internal and not marketed");
  }
  if (record.format === "1.1") {
    if (!SOURCE_PATTERN.test(record.source) || record.source === "agent:unknown") {
      issues.push("source must be native:<job> or agent:<agent name>");
    }
    for (const field of ["skill", "pack", "layer"] as const) {
      const value = record.versions[field];
      const allowed = value === "unknown" || (field === "layer" && value === "none");
      if (!allowed && !VERSION_PATTERN.test(value)) {
        issues.push(`versions.${field} must be name@version, unknown, or none`);
      }
    }
    if (record.dedupe_key && record.dedupe_key !== canonicalDedupeKey(record)) {
      issues.push("dedupe_key does not match store, target, channel, and change");
    }
  }
  if (record.finding.trim().length === 0) issues.push("finding is required");
  return issues;
}

function sealIncomingApproval(record: RecommendationRecord): void {
  const approval = { ...record.approval };
  const legacyHuman =
    (record.format ?? "1.0") === "1.0" &&
    approval.status === "PENDING_APPROVAL" &&
    approval.executed_by === "human" &&
    approval.approved_by == null &&
    approval.approved_at == null &&
    approval.executed_at == null &&
    approval.apply_result == null &&
    approval.rolled_back_by == null &&
    approval.rolled_back_at == null;
  if (legacyHuman) approval.executed_by = null;
  sealSkillJobApproval(approval);
}

function approveRules(
  record: NormalizedRecommendation,
  guards: { claimsCheck: string; noSlop: string },
): { group: "do_now" | "test" | "needs_data"; approveHidden: boolean; reason: string | null } {
  const reasons: string[] = [];
  if (guards.claimsCheck.startsWith("fail:")) reasons.push(guards.claimsCheck);
  if (guards.noSlop.startsWith("fail:")) reasons.push(guards.noSlop);
  const capacity = capacityBlocksSpend(record);
  if (capacity) reasons.push(capacity);
  const requires = unmetRequires(record.requires);
  if (requires) reasons.push(requires);
  const hasChange = Boolean(record.change?.to?.trim());
  if (hasChange && !record.rollback?.trim()) reasons.push("rollback is required before Approve");
  let group = record.group;
  if (reasons.length > 0) group = "needs_data";
  const approveHidden = group === "needs_data" || reasons.length > 0;
  return {
    group,
    approveHidden,
    reason: reasons.length > 0 ? reasons.join("; ") : group === "needs_data" ? "Needs data. Approve stays hidden." : null,
  };
}

function foldDuplicates(prepared: PreparedSkillRec[], existing: ExistingSkillRec[], now: Date): IngestAccept[] {
  const byKey = new Map<string, IngestAccept>();
  for (const row of prepared) {
    const key = row.evidence.dedupeKey;
    const already = byKey.get(key);
    if (already) {
      byKey.set(key, { prepared: mergePair(already.prepared, row), mergeIntoId: already.mergeIntoId });
      continue;
    }
    const prior = openExisting(existing, key, now);
    if (prior) {
      byKey.set(key, { prepared: mergePair(prior.prepared, row), mergeIntoId: prior.id });
      continue;
    }
    byKey.set(key, { prepared: row, mergeIntoId: null });
  }
  return [...byKey.values()].sort(
    (a, b) => groupRank(a.prepared.evidence.group) - groupRank(b.prepared.evidence.group) || impactOf(b) - impactOf(a),
  );
}

function openExisting(existing: ExistingSkillRec[], dedupeKey: string, now: Date): ExistingSkillRec | null {
  const hits = existing.filter((row) => {
    if (row.prepared.evidence.dedupeKey !== dedupeKey) return false;
    if (row.status && row.status !== "proposed") return false;
    const created = new Date(row.createdAt).getTime();
    if (Number.isNaN(created)) return false;
    return Math.abs(now.getTime() - created) <= DEDUPE_WINDOW_MS;
  });
  hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return hits[0] ?? null;
}

/** Native platform numbers win. A native rec's text wins over an agent rec. */
function mergePair(current: PreparedSkillRec, incoming: PreparedSkillRec): PreparedSkillRec {
  const incomingNative = incoming.record.source.startsWith("native:");
  const currentNative = current.evidence.sources.some((source) => source.startsWith("native:"));
  const text = incomingNative || !currentNative ? incoming : current;
  const numbers = incomingNative ? incoming : current;
  const sources = [...current.evidence.sources];
  for (const source of incoming.evidence.sources) {
    if (!sources.includes(source)) sources.push(source);
  }
  return {
    ...text,
    estimatedImpactUsd: numbers.estimatedImpactUsd,
    record: {
      ...text.record,
      source: sources[0] ?? text.record.source,
      baseline: numbers.record.baseline,
      expected_delta: numbers.record.expected_delta,
      expected_monthly_dollars: numbers.record.expected_monthly_dollars,
    },
    evidence: {
      ...text.evidence,
      source: sources[0] ?? text.evidence.source,
      sources,
      expectedMonthly: numbers.evidence.expectedMonthly,
      baseline: numbers.evidence.baseline,
      expectedDelta: numbers.evidence.expectedDelta,
    },
  };
}

function groupRank(group: PreparedSkillRec["evidence"]["group"]): number {
  if (group === "do_now") return 0;
  if (group === "test") return 1;
  return 2;
}

function impactOf(row: IngestAccept): number {
  const value = row.prepared.estimatedImpactUsd;
  return value == null ? Number.NEGATIVE_INFINITY : Number(value);
}

function monthlyRange(record: NormalizedRecommendation): SkillRecEvidence["expectedMonthly"] {
  const dollars = record.expected_monthly_dollars;
  if (!dollars) return null;
  return {
    low: typeof dollars.low === "number" ? dollars.low : null,
    high: typeof dollars.high === "number" ? dollars.high : null,
  };
}

function impactUsd(record: Pick<NormalizedRecommendation, "expected_monthly_dollars">): string | null {
  const range = record.expected_monthly_dollars;
  if (!range) return null;
  const low = typeof range.low === "number" ? range.low : null;
  const high = typeof range.high === "number" ? range.high : null;
  if (low == null && high == null) return null;
  const mid = low != null && high != null ? (low + high) / 2 : (high ?? low ?? 0);
  return mid.toFixed(2);
}

function confidenceNumber(value: NormalizedRecommendation["confidence"]): string | null {
  if (value === "low") return "0.3300";
  if (value === "medium") return "0.6600";
  if (value === "high") return "0.9000";
  return null;
}

function riskLevel(record: NormalizedRecommendation): "low" | "medium" | "high" {
  const text = (record.risk ?? "").toLowerCase();
  if (text === "low" || text.startsWith("low")) return "low";
  if (text === "high" || text.startsWith("high")) return "high";
  if (record.confidence === "low") return "high";
  if (record.confidence === "high") return "low";
  return "medium";
}

function readId(input: unknown): string | null {
  if (typeof input === "object" && input !== null && "id" in input && typeof input.id === "string") return input.id;
  return null;
}

function reasonsOf(error: unknown): string[] {
  if (error instanceof RecommendationValidationError) return error.issues;
  if (error instanceof RecommendationYamlError || error instanceof SkillJobApprovalError) return [error.message];
  if (error instanceof Error && error.message) return [error.message];
  return ["record was rejected"];
}
