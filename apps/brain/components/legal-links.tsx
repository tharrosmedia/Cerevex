import Link from 'next/link';
import { LEGAL_PAGES } from '@/lib/public-paths';

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav className={className} aria-label="Legal">
      {LEGAL_PAGES.map((page) => (
        <Link key={page.href} href={page.href}>
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
