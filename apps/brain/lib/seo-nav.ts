export type SeoNavItem = {
  href: string;
  label: string;
  rail?: string;
};

export const SEO_NAV: SeoNavItem[] = [
  { href: '/seo', label: 'Overview' },
  { href: '/seo/create', label: 'New content', rail: 'New' },
  { href: '/seo/live', label: 'Live catalog', rail: 'Catalog' },
  { href: '/seo/search', label: 'Search Console', rail: 'GSC' },
  { href: '/seo/findings', label: 'Recommendations' },
  { href: '/seo/jobs', label: 'SEO jobs' },
];
