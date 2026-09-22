'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ModuleFlags } from '@shopify-brain/contracts/modules';
import { adsSub } from '@/lib/ads-nav';
import { navSectionFromPath, railItemsForSection } from '@/lib/nav-section';

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
  items,
  open,
  onToggle,
  onClose,
}: {
  id: 'seo' | 'ads';
  label: string;
  href: string;
  items: NavItem[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  useDismissibleMenu(open, onClose, itemRef);

  return (
    <div
      ref={itemRef}
      className={open ? 'site-nav-relative site-nav-pair is-open' : 'site-nav-relative site-nav-pair'}
    >
      <Link href={href} className="site-nav-current">
        {label}
      </Link>
      <button
        type="button"
        className="site-nav-menu-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={`${id}-menu`}
        aria-label={`${label} menu`}
      >
        {open ? '▴' : '▾'}
      </button>
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
  modules = null,
  railExtra,
}: {
  adsOrigin?: string;
  modules?: ModuleFlags | null;
  railExtra?: ReactNode;
}) {
  const pathname = usePathname();
  const section = navSectionFromPath(pathname);
  const [open, setOpen] = useState(false);
  const adsItems = adsSub(adsOrigin, modules);
  const rail = railItemsForSection(section, SEO_SUB, adsItems);

  useEffect(() => {
    setOpen(false);
  }, [pathname, section]);

  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <>
      <nav className="site-nav" aria-label="Cerevex">
        {section === 'seo' ? (
          <NavMenu
            id="seo"
            label="SEO"
            href="/seo"
            items={SEO_SUB}
            open={open}
            onToggle={() => setOpen((current) => !current)}
            onClose={closeMenu}
          />
        ) : (
          <Link href="/seo">SEO</Link>
        )}
        {section === 'ads' ? (
          <NavMenu
            id="ads"
            label="Ads"
            href="/ads"
            items={adsItems}
            open={open}
            onToggle={() => setOpen((current) => !current)}
            onClose={closeMenu}
          />
        ) : (
          <Link href="/ads">Ads</Link>
        )}
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
