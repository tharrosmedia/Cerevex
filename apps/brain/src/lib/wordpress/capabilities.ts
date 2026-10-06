import {
  resolveWorkspaceCapabilities,
  wordpressApplyBlockedReason,
  wordpressConnectBlockedReason,
  wordpressSyncBlockedReason,
  type CapabilityFlags,
} from '@cerevex/contracts';
import { getWorkspaceProductSettings } from '../db/workspace-modules';
import { authoritativeApplyOn, effectiveApplyFlag, explicitStoredApplyFlag } from '../ads-apply-gate';
import { flagsWithConfirmedSafety } from '../ads-confirmed-safety';

/** Same wait as getWorkspaceProductSettings before it keeps the selected store's copy. */
export const WORDPRESS_CONNECT_SETTINGS_TIMEOUT_MS = 1500;

type WorkspaceCapabilityRead = {
  capabilities?: Partial<CapabilityFlags> | null;
};

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function wordpressWorkspaceSettingsFromStore(
  store: { config?: Record<string, unknown> } | null | undefined,
): Record<string, unknown> {
  return asRecord(asRecord(store?.config).workspace);
}

export function wordpressFlagsFromWorkspace(workspaceSettings: unknown): CapabilityFlags {
  return resolveWorkspaceCapabilities(asRecord(workspaceSettings));
}

export function wordpressFlagsFromStore(store: { config?: Record<string, unknown> } | null | undefined): CapabilityFlags {
  return flagsWithConfirmedSafety(wordpressWorkspaceSettingsFromStore(store));
}

export function wordpressConnectBlockedFromWorkspace(workspaceSettings: unknown): string | null {
  return wordpressConnectBlockedReason(wordpressFlagsFromWorkspace(workspaceSettings));
}

function sharedConnectState(settings: WorkspaceCapabilityRead | null): CapabilityFlags['site.wordpress.connect'] | null {
  const caps = settings?.capabilities;
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return null;
  if (Object.keys(caps).length === 0) return null;
  return resolveWorkspaceCapabilities({ capabilities: caps })['site.wordpress.connect'];
}

/**
 * Add-site gate for site.wordpress.connect only.
 * The shared ads workspace wins. Sync and apply stay on the store copy.
 * If ads-api does not answer within 1.5s, the selected store's copy is used.
 */
export async function wordpressConnectFlagsForAddSite(
  store: { config?: Record<string, unknown> } | null | undefined,
  options?: {
    readProductSettings?: () => Promise<WorkspaceCapabilityRead>;
    timeoutMs?: number;
  },
): Promise<CapabilityFlags> {
  const read = options?.readProductSettings ?? (() => getWorkspaceProductSettings());
  const timeoutMs = options?.timeoutMs ?? WORDPRESS_CONNECT_SETTINGS_TIMEOUT_MS;
  const storeFlags = wordpressFlagsFromStore(store);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settings = await new Promise<WorkspaceCapabilityRead | null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      Promise.resolve()
        .then(() => read())
        .then(
          (value) => resolve(value),
          () => resolve(null),
        );
    });
    const connect = sharedConnectState(settings);
    if (connect) {
      return { ...storeFlags, 'site.wordpress.connect': connect };
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  return storeFlags;
}

/** An explicit local hidden or recommend_only blocks. A missing key defers to ads. */
export async function wordpressFlagsForGate(
  store: { config?: Record<string, unknown> } | null | undefined,
): Promise<CapabilityFlags> {
  const flags = wordpressFlagsFromStore(store);
  flags['site.wordpress.apply'] = effectiveApplyFlag(
    explicitStoredApplyFlag(wordpressWorkspaceSettingsFromStore(store), 'site.wordpress.apply'),
    await authoritativeApplyOn('site.wordpress.apply'),
  );
  return flags;
}

export async function wordpressApplyGateReason(
  store: { config?: Record<string, unknown> } | null | undefined,
): Promise<string | null> {
  return wordpressApplyBlockedReason(await wordpressFlagsForGate(store));
}

export function wordpressGateReasons(store: { config?: Record<string, unknown> } | null | undefined) {
  const flags = wordpressFlagsFromStore(store);
  return {
    flags,
    connect: wordpressConnectBlockedReason(flags),
    sync: wordpressSyncBlockedReason(flags),
    apply: wordpressApplyBlockedReason(flags),
  };
}
