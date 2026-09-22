/**
 * Cross-app origins for the one-customer Cerevex shell.
 * Ads stays a separate service (auth isolation). The console links to it as a module.
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
