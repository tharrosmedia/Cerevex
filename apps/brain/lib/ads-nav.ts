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

export function adsSub(adsOrigin: string, modules?: ModuleFlags | null): AdsNavItem[] {
  const items: AdsNavItem[] = [
    { href: '/ads', label: 'Overview' },
    { href: adsOrigin ? `${adsOrigin}/app/clients` : '/ads', label: 'Clients', rail: 'Clients', module: 'clients' },
    { href: adsOrigin ? `${adsOrigin}/app/brainstorm` : '/ads', label: 'Leads', rail: 'Leads', module: 'leads' },
    { href: adsOrigin ? `${adsOrigin}/app/sales` : '/ads', label: 'Sales', rail: 'Sales', module: 'sales' },
    { href: adsOrigin ? `${adsOrigin}/app/workflows` : '/ads', label: 'Workflows', rail: 'Workflows', module: 'workflows' },
    { href: '/settings', label: 'Modules' },
  ];
  return filterItemsByModules(items, modules ?? unboardedModules());
}
