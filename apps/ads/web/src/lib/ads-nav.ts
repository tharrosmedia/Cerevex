import type { AdsModuleId, ModuleFlags } from "@tharros/ads-shared";
import { filterItemsByModules } from "@tharros/ads-shared";

export type AdsNavItem = {
  href: string;
  label: string;
  rail?: string;
  module?: AdsModuleId;
  match?: (path: string) => boolean;
};

export const ADS_NAV: AdsNavItem[] = [
  { href: "/app", label: "Overview", match: (path) => path === "/app" },
  {
    href: "/app/clients",
    label: "Clients",
    rail: "Clients",
    module: "clients",
    match: (path) => path === "/app/clients" || path.startsWith("/app/clients/"),
  },
  { href: "/app/brainstorm", label: "Leads", rail: "Leads", module: "leads" },
  { href: "/app/sales", label: "Sales", rail: "Sales", module: "sales" },
  { href: "/app/workflows", label: "Workflows", rail: "Workflows", module: "workflows" },
  { href: "/app/settings", label: "Modules" },
];

export function adsNavFor(modules: ModuleFlags | null | undefined): AdsNavItem[] {
  return filterItemsByModules(ADS_NAV, modules ?? { leads: true, clients: false, sales: false, workflows: true });
}

export function adsRailFor(modules: ModuleFlags | null | undefined): AdsNavItem[] {
  return adsNavFor(modules).filter((item) => Boolean(item.rail));
}
