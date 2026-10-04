import { resolveWorkspaceCapabilities, type CapabilityFlags, type CapabilityId } from '@cerevex/contracts';

/** Brain-only apply gates. Ads must confirm the on before the store treats it as on. */
const STORE_APPLY_GATES = ['site.wordpress.apply', 'seo.gsc.apply'] as const satisfies readonly CapabilityId[];

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function adsConfirmedSafetyIds(settings: unknown): string[] {
  const raw = asRecord(settings).adsConfirmedSafety;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string');
}

/**
 * Hand-edited local ons for the two Brain apply gates stay hidden until ads saved them.
 * Connect, sync, and recommendation flags are left as stored.
 */
export function flagsWithConfirmedSafety(settings: unknown): CapabilityFlags {
  const flags = resolveWorkspaceCapabilities(settings);
  const confirmed = new Set(adsConfirmedSafetyIds(settings));
  for (const id of STORE_APPLY_GATES) {
    if (flags[id] === 'on' && !confirmed.has(id)) flags[id] = 'hidden';
  }
  return flags;
}
