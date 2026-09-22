/**
 * Cerevex Modules & Nav IA 1.1 — workspace business type + Ads-rail flags.
 *
 * Adam lock:
 * - Leads ON for everyone
 * - Clients ON only for Agency (else OFF)
 * - Sales ON only for Ecommerce (else OFF)
 * - Workflows remain available; default ON for v1
 *
 * Settings can override flags later. Nav shows only ON modules.
 */

export const BUSINESS_TYPES = ["home_service", "agency", "ecommerce"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const ADS_MODULE_IDS = ["leads", "clients", "sales", "workflows"] as const;
export type AdsModuleId = (typeof ADS_MODULE_IDS)[number];

export type ModuleFlags = Record<AdsModuleId, boolean>;

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  home_service: "Home-service operator",
  agency: "Agency",
  ecommerce: "Ecommerce",
};

export const BUSINESS_TYPE_HELP: Record<BusinessType, string> = {
  home_service: "You run one home-service business. Leads stay on. Clients and Sales stay off unless you turn them on later.",
  agency: "You manage ads for more than one business. Clients stay on so you can switch between them.",
  ecommerce: "You run an online store. Sales stays on so you can track orders.",
};

export const MODULE_COPY: Record<AdsModuleId, { label: string; help: string }> = {
  leads: {
    label: "Leads",
    help: "People who contacted you (forms, calls, messages).",
  },
  clients: {
    label: "Clients",
    help: "For agencies managing ads for more than one business.",
  },
  sales: {
    label: "Sales",
    help: "For online stores tracking orders and sales.",
  },
  workflows: {
    label: "Workflows",
    help: "Automations. Nothing runs until you say so.",
  },
};

export type WorkspaceModuleSettings = {
  businessType: BusinessType | null;
  modules: ModuleFlags;
  onboardingComplete: boolean;
  onboardingCompletedAt: string | null;
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && (BUSINESS_TYPES as readonly string[]).includes(value);
}

export function isAdsModuleId(value: unknown): value is AdsModuleId {
  return typeof value === "string" && (ADS_MODULE_IDS as readonly string[]).includes(value);
}

export function defaultModulesFor(type: BusinessType): ModuleFlags {
  return {
    leads: true,
    clients: type === "agency",
    sales: type === "ecommerce",
    workflows: true,
  };
}

/** Before onboarding: never show Clients or Sales. */
export function unboardedModules(): ModuleFlags {
  return { leads: true, clients: false, sales: false, workflows: true };
}

export function normalizeModules(raw: unknown, fallback: ModuleFlags): ModuleFlags {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const next: ModuleFlags = { ...fallback };
  for (const id of ADS_MODULE_IDS) {
    if (typeof input[id] === "boolean") next[id] = input[id];
  }
  return next;
}

export function parseWorkspaceModuleSettings(raw: unknown): WorkspaceModuleSettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const businessType = isBusinessType(obj.businessType) ? obj.businessType : null;
  const onboardingCompletedAt =
    typeof obj.onboardingCompletedAt === "string" && obj.onboardingCompletedAt.length > 0
      ? obj.onboardingCompletedAt
      : null;
  const onboardingComplete = Boolean(businessType);
  const fallback = businessType ? defaultModulesFor(businessType) : unboardedModules();
  return {
    businessType,
    modules: normalizeModules(obj.modules, fallback),
    onboardingComplete,
    onboardingCompletedAt,
  };
}

export function settingsJsonWithBusinessType(
  existing: Record<string, unknown>,
  businessType: BusinessType,
  completedAt = new Date().toISOString(),
): Record<string, unknown> {
  return {
    ...existing,
    businessType,
    modules: defaultModulesFor(businessType),
    onboardingCompletedAt: completedAt,
  };
}

export function settingsJsonWithModuleOverrides(
  existing: Record<string, unknown>,
  overrides: Partial<ModuleFlags>,
): Record<string, unknown> {
  const parsed = parseWorkspaceModuleSettings(existing);
  return {
    ...existing,
    businessType: parsed.businessType,
    modules: normalizeModules(overrides, parsed.modules),
    onboardingCompletedAt: parsed.onboardingCompletedAt ?? new Date().toISOString(),
  };
}

export function filterItemsByModules<T extends { module?: AdsModuleId }>(
  items: T[],
  modules: ModuleFlags,
): T[] {
  return items.filter((item) => item.module == null || modules[item.module]);
}
