import type { AdsModuleId, CapabilityFlags, ModuleFlags } from "@tharros/ads-shared";
import { resolveAdsNav, unboardedModules } from "@tharros/ads-shared";
import { consoleHref } from "@/lib/console-origin";

export type AdsNavItem = {
  href: string;
  label: string;
  rail?: string;
  module?: AdsModuleId;
  match?: (path: string) => boolean;
};

const LEGACY_MATCH: Partial<Record<string, (path: string) => boolean>> = {
  "/app": (path) => path === "/app",
  "/app/clients": (path) => path === "/app/clients" || path.startsWith("/app/clients/"),
};

/**
 * One ads-nav catalog. Leftover ads-web maps local /app routes; Audits and
 * Suggestions send the operator to in-shell /ads (console).
 */
export function adsNavFor(
  modules: ModuleFlags | null | undefined,
  capabilities?: CapabilityFlags | null,
): AdsNavItem[] {
  return resolveAdsNav({
    shell: "legacyWeb",
    modules: modules ?? unboardedModules(),
    capabilities: capabilities ?? null,
  }).map((item) => {
    const href =
      item.id === "audits" || item.id === "suggestions" || item.id === "overview"
        ? item.id === "overview"
          ? "/app"
          : consoleHref(item.href)
        : item.href;
    return {
      href,
      label: item.label,
      rail: item.rail,
      module: item.module,
      match: LEGACY_MATCH[item.href],
    };
  });
}

export function adsRailFor(
  modules: ModuleFlags | null | undefined,
  capabilities?: CapabilityFlags | null,
): AdsNavItem[] {
  return adsNavFor(modules, capabilities).filter((item) => Boolean(item.rail));
}
