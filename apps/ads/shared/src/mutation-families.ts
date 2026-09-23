/**
 * Apply mutation-family registry. Families sit behind capability flags.
 * FEATURE_BID_MUTATIONS / FEATURE_BUDGET_MUTATIONS map to apply.bid / apply.budget.
 *
 * create_entity is gated by apply.create_entity (Grok Promote → Approve). No sync UI writes.
 */

import type { CapabilityFlags, CapabilityId } from "@cerevex/contracts";
import { isCapabilityOn, resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { isCreateNewMutationAction, isExecutableMutationAction } from "./mutations";
import type { MutationAction } from "./types";

export const APPLY_JOB_TYPES = ["mutate_existing", "create_entity"] as const;
export type ApplyJobType = (typeof APPLY_JOB_TYPES)[number];

export const MUTATION_FAMILY_IDS = [
  "pause",
  "negatives",
  "placement_exclude",
  "bid",
  "budget",
  "geo",
  "create_entity",
] as const;
export type MutationFamilyId = (typeof MUTATION_FAMILY_IDS)[number];

export type MutationFamily = {
  id: MutationFamilyId;
  actions: readonly MutationAction[];
  capability: CapabilityId | null;
  sealed: boolean;
  help: string;
};

export const MUTATION_FAMILIES: Record<MutationFamilyId, MutationFamily> = {
  pause: {
    id: "pause",
    actions: ["pause"],
    capability: null,
    sealed: false,
    help: "Pause an existing campaign, ad set, ad group, or ad.",
  },
  negatives: {
    id: "negatives",
    actions: ["add_negative"],
    capability: null,
    sealed: false,
    help: "Add a negative keyword to an existing entity.",
  },
  placement_exclude: {
    id: "placement_exclude",
    actions: ["exclude_placement"],
    capability: null,
    sealed: false,
    help: "Exclude a placement on an existing entity.",
  },
  bid: {
    id: "bid",
    actions: ["update_bid"],
    capability: "apply.bid",
    sealed: false,
    help: "Change bid on an existing entity. Capability apply.bid (FEATURE_BID_MUTATIONS).",
  },
  budget: {
    id: "budget",
    actions: ["update_budget"],
    capability: "apply.budget",
    sealed: false,
    help: "Change budget on an existing entity. Capability apply.budget (FEATURE_BUDGET_MUTATIONS).",
  },
  geo: {
    id: "geo",
    actions: ["tighten_geo"],
    capability: null,
    sealed: false,
    help: "Record a service-area tighten after Approve. Live location targeting stays out of this slice.",
  },
  create_entity: {
    id: "create_entity",
    actions: ["create_ad", "add_keyword"],
    capability: "apply.create_entity",
    sealed: true,
    help: "Create-new path (create_ad / add_keyword) after Grok Promote → Approve. Off until apply.create_entity is on. No sync UI writes.",
  },
};

export function mutationFamilyForAction(action: string): MutationFamily | null {
  for (const family of Object.values(MUTATION_FAMILIES)) {
    if ((family.actions as readonly string[]).includes(action)) return family;
  }
  return null;
}

export function isMutationFamilyEnabled(
  family: MutationFamily,
  flags: CapabilityFlags = resolveWorkspaceCapabilities({}),
): boolean {
  if (!family.capability) return true;
  return isCapabilityOn(family.capability, flags);
}

export function inferApplyJobType(mutations: unknown): ApplyJobType {
  const list = Array.isArray(mutations) ? mutations : [];
  if (list.length === 0) return "mutate_existing";
  const actions = list.map((row) =>
    row && typeof row === "object" && "action" in row ? String((row as { action?: unknown }).action ?? "") : "",
  );
  if (actions.every((action) => isCreateNewMutationAction(action))) return "create_entity";
  return "mutate_existing";
}

export function isSealedCreateEntityJob(jobType: string | null | undefined): boolean {
  return jobType === "create_entity";
}

export function mutationFamilySkipReason(family: MutationFamily): string {
  if (family.id === "bid") {
    return "Bid mutations are rolled back (apply.bid / FEATURE_BID_MUTATIONS off).";
  }
  if (family.id === "budget") {
    return "Budget mutations are rolled back (apply.budget / FEATURE_BUDGET_MUTATIONS off).";
  }
  if (family.sealed) {
    return "Create-entity job is sealed until apply.create_entity is on. No platform write.";
  }
  return `Mutation family ${family.id} is off for this workspace.`;
}

export function executableActionsFor(flags: CapabilityFlags): MutationAction[] {
  const out: MutationAction[] = [];
  for (const family of Object.values(MUTATION_FAMILIES)) {
    if (family.sealed && !isMutationFamilyEnabled(family, flags)) continue;
    if (!isMutationFamilyEnabled(family, flags)) continue;
    for (const action of family.actions) {
      if (isExecutableMutationAction(action)) out.push(action);
    }
  }
  return out;
}
