import { resolveWorkspaceCapabilities, type CapabilityFlags } from '@cerevex/contracts';
import { getWorkspaceProductSettings } from '../db/workspace-modules';
import { wordpressFlagsFromStore } from './capabilities';

/** Same wait as getWorkspaceProductSettings before it keeps the selected store's copy. */
export const WORDPRESS_CONNECT_SETTINGS_TIMEOUT_MS = 1500;

type WorkspaceCapabilityRead = {
  capabilities?: Partial<CapabilityFlags> | null;
};

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
 * Kept out of capabilities.ts so the SEO worker does not typecheck this Next module.
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
