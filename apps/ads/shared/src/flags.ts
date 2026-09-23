/**
 * M5 feature flags. Bid/budget mutations are ON under Approve.
 * Set FEATURE_BID_MUTATIONS=0 or FEATURE_BUDGET_MUTATIONS=0 to roll back.
 * Browser-safe: process.env only — do not import node:fs.
 */

function flagOn(name: string, defaultOn = true): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultOn;
  return raw !== "0" && raw.toLowerCase() !== "false" && raw.toLowerCase() !== "off";
}

export function bidMutationsEnabled(): boolean {
  return flagOn("FEATURE_BID_MUTATIONS", true);
}

export function budgetMutationsEnabled(): boolean {
  return flagOn("FEATURE_BUDGET_MUTATIONS", true);
}

export function applyFeatureFlags(): { bid: boolean; budget: boolean } {
  return { bid: bidMutationsEnabled(), budget: budgetMutationsEnabled() };
}
