'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export default function SeoNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isSeo = pathname?.startsWith('/seo');
  const sub = [
    { href: '/seo', label: 'Overview' },
    { href: '/seo/create', label: 'New content' },
    { href: '/seo/live', label: 'Live catalog' },
    { href: '/seo/search', label: 'Search Console' },
    { href: '/seo/findings', label: 'Recommendations' },
    { href: '/seo/jobs', label: 'SEO jobs' },
  ];
  return (
    <div className="site-nav">
      <Link href="/">Home</Link>
      <div className="site-nav-relative">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="true"
        >
          SEO {open ? '▴' : '▾'}
        </button>
        {open && (
          <div className="site-nav-menu">
            {sub.map(s => (
              <Link key={s.href} href={s.href} onClick={() => setOpen(false)}>
                {s.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      <Link href="/review">Review</Link>
      <Link href="/stores">Stores</Link>
      <Link href="/settings">Settings</Link>
      <span className="site-nav-muted">Ads</span>
      {isSeo && (
        <div className="site-nav-seo-sub">
          {sub.map(s => (
            <Link key={s.href} href={s.href} className={pathname === s.href ? 'site-nav-current' : undefined}>{s.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
