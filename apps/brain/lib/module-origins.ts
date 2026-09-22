/**
 * Cross-app origins for leftover ads-web links.
 * M4 cockpit lives in-shell under /ads. Prefer ADS_API_URL + BFF instead of this hostname.
 */
export function adsModuleOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ADS_ORIGIN?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return 'https://app.cerevex.store';
  return '';
}

export function adsModuleHref(path: string): string {
  const origin = adsModuleOrigin();
  if (!origin) return '/ads';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}
