export type SeoNavItem = {
  href: string;
  label: string;
  rail?: string;
};

export const SEO_NAV: SeoNavItem[] = [
  { href: '/seo', label: 'Overview' },
  { href: '/seo/create', label: 'New content', rail: 'New' },
  { href: '/seo/live', label: 'Live catalog', rail: 'Catalog' },
  { href: '/seo/search', label: 'Search Console', rail: 'Search Console' },
  { href: '/seo/findings', label: 'Recommendations' },
  { href: '/review', label: 'Review', rail: 'Review' },
  { href: '/seo/jobs', label: 'SEO jobs' },
];
