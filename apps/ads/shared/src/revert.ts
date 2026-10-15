/**
 * Revert planner (Apply Revert R2). Pure: no database and no platform calls.
 *
 * Builds the undo of one applied pause, budget, or bid from the before/after
 * values R1 stored on the outcome. The 7-day window, owner confirm, and no-redo
 * rules are decided here. Resume is not executable yet: the connector write and
 * the live drift check are R3, the route is R4, and the button is R5.
 */

import { canApproveApply, defaultCapabilityFlags, type CapabilityFlags } from "@cerevex/contracts";
import { isMetaTwoDecimalCurrency } from "./meta-write-safety";
import type { OutcomeValue } from "./mutate-types";
import type { Platform, Role } from "./types";

/** 7 days from the original apply job's finished_at (Q5). */
export const REVERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const REVERT_REFUSAL_CODES = [
  "flag_off",
  "not_owner",
  "is_revert",
  "already_undone",
  "undo_in_flight",
  "not_applied",
  "outside_window",
  "contains_create",
  "contains_negative",
  "contains_placement",
  "contains_geo",
  "no_before_value",
  "google_pause_not_campaign",
  "non_decimal_currency",
] as const;

export type RevertRefusalCode = (typeof REVERT_REFUSAL_CODES)[number];

export type RevertActor = {
  principal: "user" | "service";
  role: Role | null;
  email: string | null;
};

export type RevertSourceRec = {
  id: string;
  type: string;
  evidence?: Record<string, unknown> | null;
  approval?: { rolled_back_at?: string | null } | null;
  proposedMutations?: unknown[] | null;
};

export type RevertSourceJob = {
  id: string;
  status: string;
  finishedAt?: string | Date | null;
  /** Outcome list. When omitted, `responseJson.outcomes` is used. */
  outcomes?: unknown[] | null;
  responseJson?: { outcomes?: unknown[] | null } | null;
};

export type PlanRevertInput = {
  rec: RevertSourceRec;
  applyJob: RevertSourceJob;
  now: Date;
  actor: RevertActor;
  /**
   * Another undo for this rec is queued or applying.
   * The planner does not look that up.
   */
  undoInFlight?: boolean;
  /** Resolved workspace flags. Omitted means catalog defaults, so apply.revert stays hidden. */
  flags?: CapabilityFlags;
};

export type PlannedRevertMutation = {
  platform: Platform;
  action: "resume" | "update_budget" | "update_bid";
  target: { entityType: string; externalId: string; name?: string };
  /**
   * `amount` is the recorded before-value in platform units (Meta minor, Google micros),
   * not dollars. `expect` is the recorded after-value. R3 writes only when live equals expect.
   */
  payload: {
    expect: OutcomeValue;
    status?: string;
    amount?: string;
    unit?: string;
    currency?: string;
  };
  execute: false;
};

export type RevertPlan =
  | {
      ok: true;
      type: "revert";
      previewOnly: boolean;
      confirmable: boolean;
      mutations: PlannedRevertMutation[];
      evidence: {
        revertOf: string;
        applyJobId: string;
        outcomes: OutcomeSnapshot[];
        writes: false;
      };
    }
  | { ok: false; code: RevertRefusalCode };

type OutcomeSnapshot = {
  action: string;
  platform: Platform;
  target: { entityType: string; externalId: string; name?: string };
  before?: OutcomeValue;
  after?: OutcomeValue;
};

type AppliedChange = {
  action: string;
  platform: Platform;
  status?: string;
  target: { entityType: string; externalId: string; name?: string };
  before?: OutcomeValue;
  after?: OutcomeValue;
  revertible?: boolean;
  revertBlock?: string;
};

const UNDOABLE_ACTIONS = new Set(["pause", "update_budget", "update_bid"]);

function refusal(code: RevertRefusalCode): RevertPlan {
  return { ok: false, code };
}

function flagsOf(flags: CapabilityFlags | undefined): CapabilityFlags {
  return flags ?? defaultCapabilityFlags();
}

/** Workspace owner on the Approve allowlist. Operators, readers, and the service key cannot confirm. */
export function revertOwnerMayConfirm(actor: RevertActor): boolean {
  if (actor.principal !== "user") return false;
  if (actor.role !== "owner") return false;
  return canApproveApply(actor.email);
}

/** Owner or operator may see a recommend-only preview. Confirm stays owner-only. */
function mayPreviewRevert(actor: RevertActor): boolean {
  if (actor.principal !== "user") return false;
  return actor.role === "owner" || actor.role === "operator";
}

function isRevertRec(rec: RevertSourceRec): boolean {
  if (rec.type === "revert") return true;
  const revertOf = rec.evidence?.revertOf;
  return typeof revertOf === "string" && revertOf.length > 0;
}

function actionOf(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const action = (row as { action?: unknown }).action;
  return typeof action === "string" ? action : null;
}

function blockedActionCode(action: string): RevertRefusalCode | null {
  if (action === "create_ad" || action === "add_keyword") return "contains_create";
  if (action === "add_negative") return "contains_negative";
  if (action === "exclude_placement") return "contains_placement";
  if (action === "tighten_geo") return "contains_geo";
  if (action === "resume") return "is_revert";
  return null;
}

function jobOutcomes(job: RevertSourceJob): unknown[] {
  if (Array.isArray(job.outcomes)) return job.outcomes;
  const nested = job.responseJson?.outcomes;
  return Array.isArray(nested) ? nested : [];
}

function asApplied(row: unknown): AppliedChange | null {
  if (!row || typeof row !== "object") return null;
  const outcome = row as AppliedChange;
  if (typeof outcome.action !== "string") return null;
  if (outcome.platform !== "meta" && outcome.platform !== "google") return null;
  const target = outcome.target;
  if (!target || typeof target.entityType !== "string" || typeof target.externalId !== "string") return null;
  if (!target.entityType || !target.externalId) return null;
  return outcome;
}

function isOutcomeValue(value: unknown): value is OutcomeValue {
  if (!value || typeof value !== "object") return false;
  const row = value as OutcomeValue;
  return typeof row.unit === "string" && row.unit.length > 0 && typeof row.readAt === "string";
}

function copyValue(value: OutcomeValue): OutcomeValue {
  return { ...value };
}

function finishedAtMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function insideWindow(job: RevertSourceJob, now: Date): boolean {
  const finished = finishedAtMs(job.finishedAt);
  const at = now.getTime();
  if (finished == null || !Number.isFinite(at)) return false;
  const age = at - finished;
  return age >= 0 && age <= REVERT_WINDOW_MS;
}

/** Google resume is not a live write, so a Google pause has no undo yet. */
function googlePauseTargetBlocked(change: AppliedChange): boolean {
  return change.action === "pause" && change.platform === "google";
}

function moneyCurrencyBlocked(change: AppliedChange): boolean {
  if (change.action !== "update_budget" && change.action !== "update_bid") return false;
  return !isMetaTwoDecimalCurrency(change.before?.currency);
}

function missingBefore(change: AppliedChange): boolean {
  if (change.revertible === false || change.revertBlock === "no_before_value") return true;
  if (!isOutcomeValue(change.before) || !isOutcomeValue(change.after)) return true;
  if (change.action === "pause") {
    const status = change.before.status?.trim().toLowerCase();
    return !status || status === "paused";
  }
  if (change.action === "update_budget" || change.action === "update_bid") {
    return typeof change.before.amount !== "string" || !/^\d+$/.test(change.before.amount);
  }
  return true;
}

function toMutation(change: AppliedChange): PlannedRevertMutation | null {
  if (!isOutcomeValue(change.before) || !isOutcomeValue(change.after)) return null;
  const target = {
    entityType: change.target.entityType,
    externalId: change.target.externalId,
    ...(change.target.name ? { name: change.target.name } : {}),
  };
  if (change.action === "pause") {
    const status = change.before.status?.trim();
    if (!status) return null;
    return {
      platform: change.platform,
      action: "resume",
      target,
      payload: { expect: copyValue(change.after), status },
      execute: false,
    };
  }
  if (change.action === "update_budget" || change.action === "update_bid") {
    if (!change.before.amount) return null;
    return {
      platform: change.platform,
      action: change.action,
      target,
      payload: {
        expect: copyValue(change.after),
        amount: change.before.amount,
        unit: change.before.unit,
        ...(change.before.currency ? { currency: change.before.currency } : {}),
      },
      execute: false,
    };
  }
  return null;
}

function snapshot(change: AppliedChange): OutcomeSnapshot {
  return {
    action: change.action,
    platform: change.platform,
    target: {
      entityType: change.target.entityType,
      externalId: change.target.externalId,
      ...(change.target.name ? { name: change.target.name } : {}),
    },
    ...(isOutcomeValue(change.before) ? { before: copyValue(change.before) } : {}),
    ...(isOutcomeValue(change.after) ? { after: copyValue(change.after) } : {}),
  };
}

/**
 * Plan one undo of a prior applied pause, budget, or bid.
 * Returns the mutations in reverse apply order. Nothing here writes.
 */
export function planRevert(input: PlanRevertInput): RevertPlan {
  const { rec, applyJob, now, actor } = input;
  if (isRevertRec(rec)) return refusal("is_revert");

  const state = flagsOf(input.flags)["apply.revert"];
  if (state !== "on" && state !== "recommend_only") return refusal("flag_off");
  if (state === "on") {
    if (!revertOwnerMayConfirm(actor)) return refusal("not_owner");
  } else if (!mayPreviewRevert(actor)) {
    return refusal("not_owner");
  }

  const rolledBack = rec.approval?.rolled_back_at;
  if (typeof rolledBack === "string" && rolledBack.length > 0) return refusal("already_undone");
  if (input.undoInFlight) return refusal("undo_in_flight");
  if (applyJob.status !== "succeeded") return refusal("not_applied");
  if (!insideWindow(applyJob, now)) return refusal("outside_window");

  const proposed = Array.isArray(rec.proposedMutations) ? rec.proposedMutations : [];
  const rawOutcomes = jobOutcomes(applyJob);
  for (const row of [...proposed, ...rawOutcomes]) {
    const action = actionOf(row);
    if (!action) continue;
    const blocked = blockedActionCode(action);
    if (blocked) return refusal(blocked);
  }

  const applied: AppliedChange[] = [];
  for (const row of rawOutcomes) {
    const change = asApplied(row);
    if (!change || change.status !== "applied") continue;
    if (!UNDOABLE_ACTIONS.has(change.action)) return refusal("not_applied");
    applied.push(change);
  }
  if (applied.length === 0) return refusal("not_applied");

  for (const change of applied) {
    if (googlePauseTargetBlocked(change)) return refusal("google_pause_not_campaign");
  }
  for (const change of applied) {
    if (missingBefore(change)) return refusal("no_before_value");
  }
  for (const change of applied) {
    if (moneyCurrencyBlocked(change)) return refusal("non_decimal_currency");
  }

  const mutations: PlannedRevertMutation[] = [];
  for (const change of [...applied].reverse()) {
    const mutation = toMutation(change);
    if (!mutation) return refusal("no_before_value");
    mutations.push(mutation);
  }

  const previewOnly = state === "recommend_only";
  return {
    ok: true,
    type: "revert",
    previewOnly,
    confirmable: !previewOnly,
    mutations,
    evidence: {
      revertOf: rec.id,
      applyJobId: applyJob.id,
      outcomes: applied.map(snapshot),
      writes: false,
    },
  };
}
