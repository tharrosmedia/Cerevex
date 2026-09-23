/**
 * Single ads-nav catalog. In-shell /ads is the operator path.
 * Leftover apps/ads/web maps the same ids to /app/* (or console /ads).
 */

import {
  CAPABILITY_CATALOG,
  defaultCapabilityFlags,
  filterItemsByCapabilities,
  isCapabilityVisible,
  type CapabilityFlags,
  type CapabilityId,
} from "./capabilities";
import { filterItemsByModules, unboardedModules, type AdsModuleId, type ModuleFlags } from "./modules";

/** IA module `leads` maps to this dark capability. Surface/nav require both. */
export const LEADS_CAPABILITY_ID = "m51.brainstorm" as const;

export const LEADS_NOT_LIVE_COPY =
  "Leads is not live yet. The Ads menu will not show it until that work ships.";

export function isLeadsProductUnfinished(): boolean {
  return CAPABILITY_CATALOG[LEADS_CAPABILITY_ID].unfinished;
}

export function isLeadsSurfaceVisible(
  modules?: ModuleFlags | null,
  capabilities?: CapabilityFlags | null,
): boolean {
  const mods = modules ?? unboardedModules();
  const flags = capabilities ?? defaultCapabilityFlags();
  return Boolean(mods.leads) && isCapabilityVisible(LEADS_CAPABILITY_ID, flags);
}

export const ADS_NAV_SHELLS = ["inShell", "legacyWeb"] as const;
export type AdsNavShell = (typeof ADS_NAV_SHELLS)[number];

export const ADS_NAV_ITEM_IDS = [
  "overview",
  "audits",
  "suggestions",
  "creatives",
  "funnel",
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
  { id: "creatives", label: "Creatives", rail: "Creatives", capability: "m51.grok_creatives" },
  { id: "funnel", label: "Funnel", rail: "Funnel", capability: "m51.ga4_connect" },
  { id: "clients", label: "Clients", rail: "Clients", module: "clients" },
  { id: "leads", label: "Leads", rail: "Leads", module: "leads", capability: LEADS_CAPABILITY_ID },
  { id: "sales", label: "Sales", rail: "Sales", module: "sales" },
  { id: "workflows", label: "Workflows", rail: "Workflows", module: "workflows" },
  { id: "modules", label: "Modules" },
];

/** In-shell Cerevex console. Preferred operator path. */
export const ADS_NAV_HREFS_IN_SHELL: Record<AdsNavItemId, string> = {
  overview: "/ads",
  audits: "/ads/audits",
  suggestions: "/ads/suggestions",
  creatives: "/ads/creatives",
  funnel: "/ads/funnel",
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
  creatives: "/ads/creatives",
  funnel: "/ads/funnel",
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
  const capabilities = input.capabilities ?? defaultCapabilityFlags();
  const byModule = filterItemsByModules(ADS_NAV_CATALOG, modules);
  const byCapability = filterItemsByCapabilities(byModule, capabilities);
  return byCapability.map((item) => ({ ...item, href: hrefs[item.id] }));
}
