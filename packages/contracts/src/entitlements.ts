/**
 * Plan and location entitlements (Pricing and Scholarship 1.1, item 1).
 *
 * The tenant is the OS client: one business, many stores, ad accounts on the
 * client. A location is one store_id. Only active locations count.
 *
 * Monthly usage is declared here so the next change can share one counter
 * between in-app and MCP. This module does not count, store, or reset usage.
 * When that counter lands it should:
 * - allow 20 creative variations and 10 SEO jobs on Scholarship
 * - leave the paid plan unlimited
 * - count a rec or job once, when it is created
 * - skip rejected, duplicate, and merged
 * - reset on the 1st of each calendar month, America/New_York
 */

export const PLAN_IDS = ["paid", "scholarship"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const LOCATION_STATUSES = ["active", "inactive"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const SCHOLARSHIP_LOCATION_LIMIT = 1;
export const SCHOLARSHIP_AD_ACCOUNTS_PER_PLATFORM = 1;

/** Exact monthly limits. The paid plan has no usage limit. */
export const SCHOLARSHIP_MONTHLY_LIMITS = {
  creativeVariations: 20,
  seoJobs: 10,
} as const;

export const MONTHLY_CAP_IDS = ["creative_variations", "seo_jobs"] as const;
export type MonthlyCapId = (typeof MONTHLY_CAP_IDS)[number];

export const MONTHLY_CAP_COUNTED_AT = "creation" as const;
export const MONTHLY_CAP_EXCLUDED_OUTCOMES = ["rejected", "duplicate", "merged"] as const;
export const MONTHLY_CAP_RESET = "month_start_et" as const;

export const SCHOLARSHIP_LOCATION_MESSAGE =
  "This Scholarship includes 1 location. Turn the current location off to switch, or move to the paid plan to add every location.";

export const SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE =
  "This account has more than one location turned on. Turn the extra locations off before moving to the Scholarship.";

export type MonthlyCapSpec = {
  id: MonthlyCapId;
  /** Null means this plan has no limit. */
  limit: number | null;
  countedAt: typeof MONTHLY_CAP_COUNTED_AT;
  excludedOutcomes: typeof MONTHLY_CAP_EXCLUDED_OUTCOMES;
  reset: typeof MONTHLY_CAP_RESET;
};

/** `used` stays null until the shared monthly counter exists. */
export type MonthlyCapView = MonthlyCapSpec & {
  used: number | null;
};

export type TenantEntitlements = {
  tenantId: string;
  plan: PlanId;
  locations: {
    limit: number | null;
    activeCount: number;
  };
  adAccounts: {
    limitPerPlatform: number | null;
    activeByPlatform: Record<string, number>;
  };
  monthly: {
    creativeVariations: MonthlyCapView;
    seoJobs: MonthlyCapView;
  };
};

export type EntitlementDecision = {
  allowed: true;
} | {
  allowed: false;
  message: string;
};

const INACTIVE_AD_ACCOUNT_STATUS = "disconnected";

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export function isLocationStatus(value: string): value is LocationStatus {
  return (LOCATION_STATUSES as readonly string[]).includes(value);
}

/** Anything other than disconnected still holds the Scholarship slot. */
export function isActiveAdAccountStatus(status: string): boolean {
  return status !== INACTIVE_AD_ACCOUNT_STATUS;
}

export function locationLimit(plan: PlanId): number | null {
  return plan === "scholarship" ? SCHOLARSHIP_LOCATION_LIMIT : null;
}

export function adAccountLimitPerPlatform(plan: PlanId): number | null {
  return plan === "scholarship" ? SCHOLARSHIP_AD_ACCOUNTS_PER_PLATFORM : null;
}

function monthlyCap(id: MonthlyCapId, limit: number | null): MonthlyCapView {
  return {
    id,
    limit,
    used: null,
    countedAt: MONTHLY_CAP_COUNTED_AT,
    excludedOutcomes: MONTHLY_CAP_EXCLUDED_OUTCOMES,
    reset: MONTHLY_CAP_RESET,
  };
}

export function monthlyCapsFor(plan: PlanId): TenantEntitlements["monthly"] {
  if (plan === "paid") {
    return {
      creativeVariations: monthlyCap("creative_variations", null),
      seoJobs: monthlyCap("seo_jobs", null),
    };
  }
  return {
    creativeVariations: monthlyCap("creative_variations", SCHOLARSHIP_MONTHLY_LIMITS.creativeVariations),
    seoJobs: monthlyCap("seo_jobs", SCHOLARSHIP_MONTHLY_LIMITS.seoJobs),
  };
}

export function adPlatformPlainName(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (key === "meta") return "Meta";
  if (key === "google") return "Google Ads";
  return platform.trim() || "ad";
}

export function scholarshipDowngradeAdAccountMessage(platform: string): string {
  const key = platform.trim().toLowerCase();
  const accounts =
    key === "google" ? "Google Ads account" : key === "meta" ? "Meta ad account" : `${adPlatformPlainName(platform)} ad account`;
  return `This account has more than one ${accounts} connected. Disconnect the extra ones before moving to the Scholarship.`;
}

export function adAccountLimitMessage(platform: string): string {
  const key = platform.trim().toLowerCase();
  const account =
    key === "google"
      ? "1 Google Ads account"
      : key === "meta"
        ? "1 Meta ad account"
        : `1 ${adPlatformPlainName(platform)} ad account`;
  return `This Scholarship includes ${account}. Disconnect the current one to switch, or move to the paid plan for unlimited ad accounts.`;
}

function allow(): EntitlementDecision {
  return { allowed: true };
}

function block(message: string): EntitlementDecision {
  return { allowed: false, message };
}

/**
 * `activeStoreIds` must already exclude inactive stores.
 * `replacingStoreId` is the location being turned off in the same change
 * (a site swap). It does not count against the limit.
 */
export function decideLocationActivation(input: {
  plan: PlanId;
  storeId: string;
  activeStoreIds: readonly string[];
  replacingStoreId?: string | null;
}): EntitlementDecision {
  const limit = locationLimit(input.plan);
  if (limit === null) return allow();
  const next = new Set(input.activeStoreIds);
  if (input.replacingStoreId) next.delete(input.replacingStoreId);
  next.add(input.storeId);
  if (next.size > limit) return block(SCHOLARSHIP_LOCATION_MESSAGE);
  return allow();
}

/**
 * One active ad account per platform value. A new platform on the schema
 * gets the same rule. Reconnecting the same account, or replacing the row
 * being updated, does not open a second slot.
 */
export function decideAdAccountActivation(input: {
  plan: PlanId;
  platform: string;
  activeExternalIds: readonly string[];
  externalId: string;
  replacingExternalId?: string | null;
}): EntitlementDecision {
  return decideAdAccountActivations({
    plan: input.plan,
    platform: input.platform,
    activeExternalIds: input.activeExternalIds,
    externalIds: [input.externalId],
    replacingExternalIds: input.replacingExternalId ? [input.replacingExternalId] : [],
  });
}

export function decideAdAccountActivations(input: {
  plan: PlanId;
  platform: string;
  activeExternalIds: readonly string[];
  externalIds: readonly string[];
  replacingExternalIds?: readonly string[];
}): EntitlementDecision {
  const limit = adAccountLimitPerPlatform(input.plan);
  if (limit === null) return allow();
  const next = new Set(input.activeExternalIds);
  for (const id of input.replacingExternalIds ?? []) next.delete(id);
  for (const id of input.externalIds) next.add(id);
  if (next.size > limit) return block(adAccountLimitMessage(input.platform));
  return allow();
}
