export type NavSection = 'seo' | 'ads';

export function navSectionFromPath(pathname: string | null | undefined): NavSection | null {
  if (!pathname) return null;
  if (pathname === '/seo' || pathname.startsWith('/seo/')) return 'seo';
  if (pathname === '/ads' || pathname.startsWith('/ads/')) return 'ads';
  return null;
}

export function railItemsForSection<T extends { rail?: string }>(
  section: NavSection | null,
  seoItems: T[],
  adsItems: T[],
): T[] {
  if (section === 'seo') return seoItems.filter((item) => Boolean(item.rail));
  if (section === 'ads') return adsItems.filter((item) => Boolean(item.rail));
  return [];
}
