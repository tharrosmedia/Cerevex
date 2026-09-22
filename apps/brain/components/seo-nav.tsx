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
    <div className="flex items-center gap-4 text-sm">
      <Link href="/" className="underline">Home</Link>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="underline flex items-center gap-1"
          aria-expanded={open}
        >
          SEO {open ? '▴' : '▾'}
        </button>
        {open && (
          <div className="absolute left-0 mt-1 bg-background border rounded shadow p-1 z-10 min-w-[140px]">
            {sub.map(s => (
              <Link key={s.href} href={s.href} className="block px-2 py-1 hover:bg-muted" onClick={() => setOpen(false)}>
                {s.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      <Link href="/review" className="underline">Review</Link>
      <Link href="/stores" className="underline">Stores</Link>
      <Link href="/settings" className="underline">Settings</Link>
      <span className="text-muted-foreground">Ads</span>
      <span className="text-muted-foreground">Inventory</span>
      <span className="text-muted-foreground">Service</span>
      <span className="text-muted-foreground">Fulfillment</span>
      {isSeo && (
        <div className="ml-2 flex gap-3 text-xs border-l pl-3">
          {sub.map(s => (
            <Link key={s.href} href={s.href} className={pathname === s.href ? 'font-semibold underline' : 'underline'}>{s.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
