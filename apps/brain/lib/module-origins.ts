/**
 * Leftover ads-web cross-origin links are gated (R4).
 * Operator path is in-shell /ads + ADS_API_URL BFF.
 * Set NEXT_PUBLIC_ADS_ORIGIN only when shell.legacy_ads_web is intentionally on.
 */
export function adsModuleOrigin(): string {
  if (process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME === '1') {
    return (process.env.NEXT_PUBLIC_ADS_ORIGIN ?? '').replace(/\/$/, '');
  }
  return '';
}

export function adsModuleHref(path: string): string {
  const origin = adsModuleOrigin();
  if (!origin) return '/ads';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}
