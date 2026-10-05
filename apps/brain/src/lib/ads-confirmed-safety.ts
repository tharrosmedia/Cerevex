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
 * The two Brain apply gates are never taken from store config or the workspace cookie.
 * Ads is read at gate time. Connect, sync, and recommendation flags stay as stored.
 */
export function flagsWithConfirmedSafety(settings: unknown): CapabilityFlags {
  const flags = resolveWorkspaceCapabilities(settings);
  for (const id of STORE_APPLY_GATES) {
    if (flags[id] === 'on') flags[id] = 'hidden';
  }
  return flags;
}

/**
 * Drop the editable marker and a stored on for the two apply gates.
 * An explicit hidden or recommend_only stays, so a local off survives the save.
 */
export function stripEditableWorkspaceSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const next = { ...settings };
  delete next.adsConfirmedSafety;
  const caps = asRecord(next.capabilities);
  if (Object.keys(caps).length > 0) {
    const capabilities = { ...caps };
    for (const id of STORE_APPLY_GATES) {
      if (capabilities[id] === 'on') delete capabilities[id];
    }
    next.capabilities = capabilities;
  }
  return next;
}

export function stripEditableApplyGates<T extends Record<string, unknown>>(config: T): T {
  const workspace = asRecord(config.workspace);
  if (Object.keys(workspace).length === 0) return config;
  return { ...config, workspace: stripEditableWorkspaceSettings(workspace) };
}
