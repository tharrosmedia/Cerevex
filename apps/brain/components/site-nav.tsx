'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

type NavItem = {
  href: string;
  label: string;
  rail?: string;
};

const SEO_SUB: NavItem[] = [
  { href: '/seo', label: 'Overview' },
  { href: '/seo/create', label: 'New content', rail: 'New' },
  { href: '/seo/live', label: 'Live catalog', rail: 'Catalog' },
  { href: '/seo/search', label: 'Search Console', rail: 'GSC' },
  { href: '/seo/findings', label: 'Recommendations' },
  { href: '/seo/jobs', label: 'SEO jobs' },
];

function adsSub(adsOrigin: string): NavItem[] {
  return [
    { href: '/ads', label: 'Overview' },
    { href: adsOrigin ? `${adsOrigin}/app` : '/ads', label: 'Clients', rail: 'Clients' },
    { href: adsOrigin ? `${adsOrigin}/app/brainstorm` : '/ads', label: 'Leads', rail: 'Leads' },
    { href: adsOrigin ? `${adsOrigin}/app/workflows` : '/ads', label: 'Workflows', rail: 'Workflows' },
  ];
}

function isExternal(href: string) {
  return href.startsWith('http://') || href.startsWith('https://');
}

function NavLink({
  href,
  className,
  children,
  onClick,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  if (isExternal(href)) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export default function SiteNav({
  adsOrigin = '',
  railExtra,
}: {
  adsOrigin?: string;
  railExtra?: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<'seo' | 'ads' | null>(null);
  const isSeo = Boolean(pathname?.startsWith('/seo'));
  const isAds = Boolean(pathname?.startsWith('/ads'));
  const adsItems = adsSub(adsOrigin);
  const rail = isAds
    ? adsItems.filter((item) => item.rail)
    : SEO_SUB.filter((item) => item.rail);

  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  return (
    <>
      <nav className="site-nav" aria-label="Cerevex">
        <div className="site-nav-relative site-nav-pair">
          <Link href="/seo" className={isSeo ? 'site-nav-current' : undefined}>
            SEO
          </Link>
          <button
            type="button"
            onClick={() => setOpen(open === 'seo' ? null : 'seo')}
            aria-expanded={open === 'seo'}
            aria-haspopup="true"
            aria-label="SEO menu"
          >
            {open === 'seo' ? '▴' : '▾'}
          </button>
          {open === 'seo' && (
            <div className="site-nav-menu">
              {SEO_SUB.map((item) => (
                <NavLink key={item.href} href={item.href} onClick={() => setOpen(null)}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
        <div className="site-nav-relative site-nav-pair">
          <Link href="/ads" className={isAds ? 'site-nav-current' : undefined}>
            Ads
          </Link>
          <button
            type="button"
            onClick={() => setOpen(open === 'ads' ? null : 'ads')}
            aria-expanded={open === 'ads'}
            aria-haspopup="true"
            aria-label="Ads menu"
          >
            {open === 'ads' ? '▴' : '▾'}
          </button>
          {open === 'ads' && (
            <div className="site-nav-menu">
              {adsItems.map((item) => (
                <NavLink key={`${item.label}-${item.href}`} href={item.href} onClick={() => setOpen(null)}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
        <Link href="/review" className={pathname === '/review' ? 'site-nav-current' : undefined}>
          Review
        </Link>
        <Link href="/stores" className={pathname?.startsWith('/stores') ? 'site-nav-current' : undefined}>
          Stores
        </Link>
        <Link href="/settings" className={pathname === '/settings' ? 'site-nav-current' : undefined}>
          Settings
        </Link>
      </nav>
      <div className="site-nav-rail">
        {rail.length > 0 && (
          <div className="site-nav-rail-items">
            {rail.map((item) => (
              <NavLink
                key={`${item.rail}-${item.href}`}
                href={item.href}
                className={pathname === item.href ? 'site-nav-current' : undefined}
              >
                {item.rail}
              </NavLink>
            ))}
          </div>
        )}
        {railExtra}
      </div>
    </>
  );
}
