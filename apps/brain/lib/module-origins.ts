/**
 * Leftover ads-web cross-origin links are gated (R4 + G8).
 * Operator path is in-shell /ads + ADS_API_URL BFF.
 *
 * One product knob: shell.legacy_ads_web (G2 hard-blocks leftover /app/*).
 * NEXT_PUBLIC_ADS_LEGACY_CHROME=1 is the deploy-time companion so a leftover
 * NEXT_PUBLIC_ADS_ORIGIN never emits console links on its own.
 */
import {
  defaultCapabilityFlags,
  legacyAdsChromeLinksAllowed,
  type CapabilityFlags,
} from '@cerevex/contracts';

export function adsModuleOrigin(flags?: CapabilityFlags | null): string {
  const resolved = flags ?? defaultCapabilityFlags();
  if (!legacyAdsChromeLinksAllowed(resolved)) return '';
  return (process.env.NEXT_PUBLIC_ADS_ORIGIN ?? '').replace(/\/$/, '');
}

export function adsModuleHref(path: string, flags?: CapabilityFlags | null): string {
  const origin = adsModuleOrigin(flags);
  if (!origin) return '/ads';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}
