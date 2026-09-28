/** Public legal routes. Middleware must not 307 these to /login. */

export const LEGAL_CONTACT_EMAIL = 'support@cerevex.store';

export const LEGAL_PAGES = [
  { href: '/terms-of-service', label: 'Terms' },
  { href: '/privacy-policy', label: 'Privacy' },
  { href: '/data-deletion', label: 'Data deletion' },
] as const;

export type LegalHref = (typeof LEGAL_PAGES)[number]['href'];

const LEGAL_HREFS = new Set<string>(LEGAL_PAGES.map((page) => page.href));

/** Drop a trailing slash. Internal slashes stay. */
export function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '');
  }
  return pathname;
}

export function isPublicLegalPath(pathname: string): boolean {
  return LEGAL_HREFS.has(stripTrailingSlash(pathname));
}

/**
 * Trailing-slash alternates of the legal routes 301 to the slashless path.
 * Anything else stays on the normal auth gate.
 */
export function publicLegalDecision(
  pathname: string,
): { kind: 'redirect'; pathname: string } | { kind: 'public' } | { kind: 'auth' } {
  const canonical = stripTrailingSlash(pathname);
  if (canonical !== pathname && LEGAL_HREFS.has(canonical)) {
    return { kind: 'redirect', pathname: canonical };
  }
  if (LEGAL_HREFS.has(pathname)) return { kind: 'public' };
  return { kind: 'auth' };
}
