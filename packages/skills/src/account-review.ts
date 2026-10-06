/**
 * Weekly account-review packet for slice 1.
 * Paid review and the two SEO jobs run. Every other loop is "not checked".
 * The packet does not change accounts and does not invent platform numbers.
 */

import { createHash } from "node:crypto";
import { SkillGateError, assertSkillRunAllowed } from "./gates";
import { runPaidMediaJob, runSeoAuditJob, runSeoResearchJob, type SkillJobRun } from "./native-jobs";
import { deterministicSpend, resolveSkillPrompt, type AiSpendLog, type ResolvedPrompt } from "./resolved-prompt";
import type { ClientSkillConfig } from "./types";

export const ACCOUNT_REVIEW_CADENCE = "weekly" as const;

/** Monday 14:00 UTC. Cerevex owns this schedule (brief §7). */
export const ACCOUNT_REVIEW_CRON = "0 14 * * 1";

export const CHECKED_LOOPS = ["Paid review", "SEO audit", "SEO research"] as const;

export const NOT_CHECKED_LOOPS = [
  "Lead quality",
  "Demand trigger",
  "Answer rate",
  "LSA disputes",
  "Outcome-import health",
  "Budget pacing",
  "Feed health",
  "Compliance scan",
  "Reviews",
  "GBP watch",
  "Ad fatigue",
  "Landing-page regression",
  "Tracking gate",
  "Creative retro",
] as const;

export interface AccountReviewLoopLine {
  loop: string;
  status: "checked" | "not_checked";
}

export interface AccountReviewApproval {
  externalId: string;
  title: string;
  group: "do_now" | "test" | "needs_data";
}

export interface AccountReviewPacket {
  cadence: typeof ACCOUNT_REVIEW_CADENCE;
  weekOf: string;
  modelId: string;
  promptHash: string;
  templateVersion: string;
  packVersion: string;
  layerVersion: string;
  checked: AccountReviewLoopLine[];
  notChecked: AccountReviewLoopLine[];
  sourcesNotChecked: string[];
  topApprovals: AccountReviewApproval[];
  counts: { doNow: number; test: number; needsData: number };
  nothingToActOn: boolean;
  note: string;
}

export interface AccountReviewRun {
  resolved: ResolvedPrompt;
  spend: AiSpendLog;
  runs: SkillJobRun[];
  packet: AccountReviewPacket;
}

export function runAccountReview(
  client: ClientSkillConfig,
  options: { now?: Date; runId?: string; gscRowCount?: number; keyword?: string } = {},
): AccountReviewRun {
  assertSkillRunAllowed({ clientSlug: client.slug, runKind: "marketing", marketingGate: client.marketingGate });
  if (!client.pilot) {
    throw new SkillGateError({ allowed: false, gate: "scope", reason: "Slice 1 pilot is HVAC USA only" });
  }
  const now = options.now ?? new Date();
  const resolved = resolveSkillPrompt(client, "account-review-loop");
  const runs = [
    runPaidMediaJob(client, "meta", { now, runId: childRunId(options.runId, "meta") }),
    runPaidMediaJob(client, "google", { now, runId: childRunId(options.runId, "google") }),
    runSeoAuditJob(client, { now, runId: childRunId(options.runId, "seo-audit"), gscRowCount: options.gscRowCount }),
    runSeoResearchJob(client, { now, runId: childRunId(options.runId, "seo-research"), keyword: options.keyword }),
  ];
  const accepted = runs.flatMap((run) => run.ingest.accepted);
  const approvable = accepted
    .filter((row) => !row.prepared.evidence.approveHidden)
    .sort((a, b) => impactOf(b.prepared.estimatedImpactUsd) - impactOf(a.prepared.estimatedImpactUsd));
  const topApprovals = approvable.slice(0, 3).map((row) => ({
    externalId: row.prepared.evidence.externalId,
    title: row.prepared.title,
    group: row.prepared.evidence.group,
  }));
  const counts = {
    doNow: accepted.filter((row) => row.prepared.evidence.group === "do_now").length,
    test: accepted.filter((row) => row.prepared.evidence.group === "test").length,
    needsData: accepted.filter((row) => row.prepared.evidence.group === "needs_data").length,
  };
  const sourcesNotChecked: string[] = [];
  for (const run of runs) {
    for (const source of run.notChecked) {
      if (!sourcesNotChecked.includes(source)) sourcesNotChecked.push(source);
    }
  }
  const nothingToActOn = topApprovals.length === 0;
  const runId =
    options.runId ??
    createHash("sha256").update(`account-review-loop:${now.toISOString()}`).digest("hex").slice(0, 16);
  return {
    resolved,
    spend: deterministicSpend(client.slug, "account-review-loop", resolved, runId),
    runs,
    packet: {
      cadence: ACCOUNT_REVIEW_CADENCE,
      weekOf: now.toISOString().slice(0, 10),
      modelId: resolved.modelId,
      promptHash: resolved.promptHash,
      templateVersion: resolved.templateVersion,
      packVersion: resolved.packVersion,
      layerVersion: resolved.layerVersion,
      checked: CHECKED_LOOPS.map((loop) => ({ loop, status: "checked" })),
      notChecked: NOT_CHECKED_LOOPS.map((loop) => ({ loop, status: "not_checked" })),
      sourcesNotChecked,
      topApprovals,
      counts,
      nothingToActOn,
      note: nothingToActOn ? "Checked, nothing to act on." : `${topApprovals.length} approvals needed.`,
    },
  };
}

function childRunId(runId: string | undefined, child: string): string | undefined {
  return runId ? `${runId}:${child}` : undefined;
}

function impactOf(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
