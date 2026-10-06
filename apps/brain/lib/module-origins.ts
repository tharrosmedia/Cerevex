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

/**
 * Owner unpause. ads-web Settings (`src/app/app/settings/page.tsx`) is the page
 * whose "Turn pause off" button calls patchWorkspace({ applyKillSwitch }).
 * Not Brain /settings, and not a leftover /app route that does not own the switch.
 */
export const ADS_OWNER_UNPAUSE_PATH = '/app/settings';

export function adsSafetySettingsHref(): string {
  const origin = (process.env.NEXT_PUBLIC_ADS_ORIGIN ?? '').replace(/\/$/, '');
  return origin ? `${origin}${ADS_OWNER_UNPAUSE_PATH}` : ADS_OWNER_UNPAUSE_PATH;
}

export function adsModuleHref(path: string, flags?: CapabilityFlags | null): string {
  const origin = adsModuleOrigin(flags);
  if (!origin) return '/ads';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}
