'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

type NavItem = {
  href: string;
  label: string;
  rail?: string;
};

type MenuId = 'seo' | 'ads';

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

function useDismissibleMenu(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, rootRef]);
}

function NavMenu({
  id,
  label,
  href,
  current,
  open,
  items,
  onToggle,
  onClose,
}: {
  id: MenuId;
  label: string;
  href: string;
  current: boolean;
  open: boolean;
  items: NavItem[];
  onToggle: () => void;
  onClose: () => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  useDismissibleMenu(open, onClose, itemRef);

  return (
    <div className={open ? 'site-nav-item is-open' : 'site-nav-item'} ref={itemRef}>
      <div className="site-nav-pair">
        <Link href={href} className={current ? 'site-nav-current' : undefined}>
          {label}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-haspopup="true"
          aria-controls={`${id}-menu`}
          aria-label={`${label} menu`}
        >
          {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div className="site-nav-menu" id={`${id}-menu`} role="menu">
          {items.map((item) => (
            <NavLink key={`${item.label}-${item.href}`} href={item.href} onClick={onClose}>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
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
  const [open, setOpen] = useState<MenuId | null>(null);
  const isSeo = Boolean(pathname?.startsWith('/seo'));
  const isAds = Boolean(pathname?.startsWith('/ads'));
  const adsItems = adsSub(adsOrigin);
  const rail = isSeo
    ? SEO_SUB.filter((item) => item.rail)
    : isAds
      ? adsItems.filter((item) => item.rail)
      : [];

  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  const closeMenu = () => setOpen(null);

  return (
    <>
      <nav className="site-nav" aria-label="Cerevex">
        <NavMenu
          id="seo"
          label="SEO"
          href="/seo"
          current={isSeo}
          open={open === 'seo'}
          items={SEO_SUB}
          onToggle={() => setOpen((current) => (current === 'seo' ? null : 'seo'))}
          onClose={closeMenu}
        />
        <NavMenu
          id="ads"
          label="Ads"
          href="/ads"
          current={isAds}
          open={open === 'ads'}
          items={adsItems}
          onToggle={() => setOpen((current) => (current === 'ads' ? null : 'ads'))}
          onClose={closeMenu}
        />
        <Link
          href="/review"
          className={pathname === '/review' ? 'site-nav-current' : undefined}
          onClick={closeMenu}
        >
          Review
        </Link>
        <Link
          href="/stores"
          className={pathname?.startsWith('/stores') ? 'site-nav-current' : undefined}
          onClick={closeMenu}
        >
          Stores
        </Link>
        <Link
          href="/settings"
          className={pathname === '/settings' ? 'site-nav-current' : undefined}
          onClick={closeMenu}
        >
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
