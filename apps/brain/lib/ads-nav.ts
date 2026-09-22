import {
  filterItemsByModules,
  unboardedModules,
  type AdsModuleId,
  type ModuleFlags,
} from '@shopify-brain/contracts';

export type AdsNavItem = {
  href: string;
  label: string;
  rail?: string;
  module?: AdsModuleId;
};

export function adsSub(_adsOrigin: string, modules?: ModuleFlags | null): AdsNavItem[] {
  const items: AdsNavItem[] = [
    { href: '/ads', label: 'Overview' },
    { href: '/ads/audits', label: 'Audits', rail: 'Audits' },
    { href: '/ads/suggestions', label: 'Suggestions', rail: 'Suggestions' },
    { href: '/ads/clients', label: 'Clients', rail: 'Clients', module: 'clients' },
    { href: '/ads/leads', label: 'Leads', rail: 'Leads', module: 'leads' },
    { href: '/ads/sales', label: 'Sales', rail: 'Sales', module: 'sales' },
    { href: '/ads/workflows', label: 'Workflows', rail: 'Workflows', module: 'workflows' },
    { href: '/settings', label: 'Modules' },
  ];
  return filterItemsByModules(items, modules ?? unboardedModules());
}
