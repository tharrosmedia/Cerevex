import {
  resolveAdsNav,
  unboardedModules,
  type AdsModuleId,
  type CapabilityFlags,
  type ModuleFlags,
} from '@shopify-brain/contracts';

export type AdsNavItem = {
  href: string;
  label: string;
  rail?: string;
  module?: AdsModuleId;
};

export function adsSub(
  _adsOrigin: string,
  modules?: ModuleFlags | null,
  capabilities?: CapabilityFlags | null,
): AdsNavItem[] {
  return resolveAdsNav({
    shell: 'inShell',
    modules: modules ?? unboardedModules(),
    capabilities: capabilities ?? null,
  }).map((item) => ({
    href: item.href,
    label: item.label,
    rail: item.rail,
    module: item.module,
  }));
}
