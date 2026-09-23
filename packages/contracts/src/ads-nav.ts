/**
 * Single ads-nav catalog. In-shell /ads is the operator path.
 * Leftover apps/ads/web maps the same ids to /app/* (or console /ads).
 */

import {
  filterItemsByCapabilities,
  type CapabilityFlags,
  type CapabilityId,
} from "./capabilities";
import { filterItemsByModules, unboardedModules, type AdsModuleId, type ModuleFlags } from "./modules";

export const ADS_NAV_SHELLS = ["inShell", "legacyWeb"] as const;
export type AdsNavShell = (typeof ADS_NAV_SHELLS)[number];

export const ADS_NAV_ITEM_IDS = [
  "overview",
  "audits",
  "suggestions",
  "clients",
  "leads",
  "sales",
  "workflows",
  "modules",
] as const;
export type AdsNavItemId = (typeof ADS_NAV_ITEM_IDS)[number];

export type AdsNavCatalogItem = {
  id: AdsNavItemId;
  label: string;
  rail?: string;
  module?: AdsModuleId;
  capability?: CapabilityId;
};

export const ADS_NAV_CATALOG: AdsNavCatalogItem[] = [
  { id: "overview", label: "Overview", capability: "cockpit" },
  { id: "audits", label: "Audits", rail: "Audits", capability: "audits" },
  { id: "suggestions", label: "Suggestions", rail: "Suggestions", capability: "cockpit" },
  { id: "clients", label: "Clients", rail: "Clients", module: "clients" },
  { id: "leads", label: "Leads", rail: "Leads", module: "leads" },
  { id: "sales", label: "Sales", rail: "Sales", module: "sales" },
  { id: "workflows", label: "Workflows", rail: "Workflows", module: "workflows" },
  { id: "modules", label: "Modules" },
];

/** In-shell Cerevex console. Preferred operator path. */
export const ADS_NAV_HREFS_IN_SHELL: Record<AdsNavItemId, string> = {
  overview: "/ads",
  audits: "/ads/audits",
  suggestions: "/ads/suggestions",
  clients: "/ads/clients",
  leads: "/ads/leads",
  sales: "/ads/sales",
  workflows: "/ads/workflows",
  modules: "/settings",
};

/**
 * Leftover ads-web. Audits/Suggestions have no local page — point at in-shell
 * paths so the operator is not sent to a second cockpit.
 */
export const ADS_NAV_HREFS_LEGACY_WEB: Record<AdsNavItemId, string> = {
  overview: "/app",
  audits: "/ads/audits",
  suggestions: "/ads/suggestions",
  clients: "/app/clients",
  leads: "/app/brainstorm",
  sales: "/app/sales",
  workflows: "/app/workflows",
  modules: "/app/settings",
};

export type ResolvedAdsNavItem = AdsNavCatalogItem & { href: string };

export function adsNavHrefsFor(shell: AdsNavShell): Record<AdsNavItemId, string> {
  return shell === "legacyWeb" ? ADS_NAV_HREFS_LEGACY_WEB : ADS_NAV_HREFS_IN_SHELL;
}

export function resolveAdsNav(input: {
  shell?: AdsNavShell;
  modules?: ModuleFlags | null;
  capabilities?: CapabilityFlags | null;
  hrefs?: Partial<Record<AdsNavItemId, string>>;
}): ResolvedAdsNavItem[] {
  const hrefs = { ...adsNavHrefsFor(input.shell ?? "inShell"), ...input.hrefs };
  const modules = input.modules ?? unboardedModules();
  const byModule = filterItemsByModules(ADS_NAV_CATALOG, modules);
  const byCapability = input.capabilities
    ? filterItemsByCapabilities(byModule, input.capabilities)
    : byModule;
  return byCapability.map((item) => ({ ...item, href: hrefs[item.id] }));
}
