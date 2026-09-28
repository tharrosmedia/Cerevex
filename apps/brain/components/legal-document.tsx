import Link from 'next/link';
import type { ReactNode } from 'react';
import { LegalLinks } from '@/components/legal-links';
import { LEGAL_CONTACT_EMAIL } from '@/lib/public-paths';

export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="site-wordmark" aria-label="Cerevex home">
          Cerevex
        </Link>
      </header>
      <main className="legal-main">
        <p className="legal-banner" role="note">
          <strong>DRAFT — pending counsel review.</strong> This page is a product outline for counsel. It is not a final legal document.
        </p>
        <h1>{title}</h1>
        <p className="legal-meta">
          Operated by Tharros Media. Product: Cerevex. Draft date: September 27, 2026.
        </p>
        <article className="legal-body">{children}</article>
        <p className="legal-contact">
          Contact:{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
        </p>
        <LegalLinks className="legal-links" />
      </main>
    </div>
  );
}
