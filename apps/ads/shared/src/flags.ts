/**
 * Apply mutation flags. Bid/budget now resolve through the capability registry.
 * FEATURE_BID_MUTATIONS=0 / FEATURE_BUDGET_MUTATIONS=0 still roll back (env kill).
 * PLATFORM_SYNC_LIVE=0 still rolls back live pull/apply (env kill → sync.live).
 * Browser-safe: process.env only — do not import node:fs.
 */

import {
  isCapabilityOn,
  isPlatformSyncLiveOn,
  resolveWorkspaceCapabilities,
  type CapabilityFlags,
} from "@cerevex/contracts";

export function bidMutationsEnabled(flags?: CapabilityFlags): boolean {
  return isCapabilityOn("apply.bid", flags ?? resolveWorkspaceCapabilities({}));
}

export function budgetMutationsEnabled(flags?: CapabilityFlags): boolean {
  return isCapabilityOn("apply.budget", flags ?? resolveWorkspaceCapabilities({}));
}

export function platformSyncLiveEnabled(flags?: CapabilityFlags): boolean {
  return isPlatformSyncLiveOn(flags ?? resolveWorkspaceCapabilities({}));
}

export function applyFeatureFlags(flags?: CapabilityFlags): { bid: boolean; budget: boolean } {
  const resolved = flags ?? resolveWorkspaceCapabilities({});
  return { bid: bidMutationsEnabled(resolved), budget: budgetMutationsEnabled(resolved) };
}
