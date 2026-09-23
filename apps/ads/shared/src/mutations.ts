/**
 * Browser-safe mutation helpers. No Node imports.
 */

import {
  CREATE_NEW_MUTATION_ACTIONS,
  EXECUTABLE_MUTATION_ACTIONS,
  type ExecutableMutationAction,
  type MutationAction,
} from "./types";

export type MutationTarget = {
  entityType: string;
  externalId: string;
  name?: string;
};

export type MutationView = {
  platform: "meta" | "google";
  action: MutationAction;
  target: MutationTarget;
  payload: Record<string, unknown>;
  execute: boolean;
};

export function isExecutableMutationAction(action: string): action is ExecutableMutationAction {
  return (EXECUTABLE_MUTATION_ACTIONS as readonly string[]).includes(action);
}

export function isCreateNewMutationAction(action: string): boolean {
  return (CREATE_NEW_MUTATION_ACTIONS as readonly string[]).includes(action);
}

export function mutationActionLabel(action: string): string {
  switch (action) {
    case "pause":
      return "Pause";
    case "update_bid":
      return "Change bid";
    case "update_budget":
      return "Change budget";
    case "add_negative":
      return "Add negative keyword";
    case "exclude_placement":
      return "Exclude placement";
    case "create_ad":
      return "Create ad";
    case "add_keyword":
      return "Add keyword";
    case "review":
      return "Review only";
    default:
      return action.replace(/[_-]+/g, " ");
  }
}

function percentFromPayload(payload: Record<string, unknown>): number | null {
  const raw = payload.percent ?? payload.changePercent;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function summarizeMutation(mutation: {
  action?: string;
  platform?: string;
  target?: { name?: string; entityType?: string; externalId?: string };
  payload?: Record<string, unknown>;
}): string {
  const action = mutation.action ?? "change";
  const name = mutation.target?.name ?? mutation.target?.externalId ?? "this entity";
  const platform = mutation.platform === "google" ? "Google Ads" : mutation.platform === "meta" ? "Meta" : "";
  const percent = mutation.payload ? percentFromPayload(mutation.payload) : null;
  const extra =
    percent != null
      ? ` by ${percent > 0 ? "+" : ""}${percent}%`
      : typeof mutation.payload?.text === "string"
        ? ` (${mutation.payload.text})`
        : typeof mutation.payload?.placement === "string"
          ? ` (${mutation.payload.placement})`
          : "";
  const where = platform ? ` on ${platform}` : "";
  return `${mutationActionLabel(action)} ${name}${extra}${where}`;
}

export function applyStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "queued":
    case "pending":
      return "Queued";
    case "applying":
      return "Applying";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "blocked":
      return "Blocked";
    default:
      return status ? status.replace(/[_-]+/g, " ") : "Not applied";
  }
}

export function connectionStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_reconnect":
      return "Needs reconnect";
    case "error":
      return "Error";
    case "syncing":
      return "Syncing";
    case "pending":
      return "Pending";
    case "disconnected":
    default:
      return status === "disconnected" ? "Not connected" : status ? status.replace(/[_-]+/g, " ") : "Not connected";
  }
}
