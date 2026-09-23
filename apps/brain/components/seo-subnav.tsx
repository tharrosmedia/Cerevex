'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SEO_NAV } from '@/lib/seo-nav';

export function SeoSubnav() {
  const pathname = usePathname();
  return (
    <nav className="cx-subnav" aria-label="SEO pages">
      {SEO_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={pathname === item.href ? 'cx-subnav-current' : undefined}
          aria-current={pathname === item.href ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
