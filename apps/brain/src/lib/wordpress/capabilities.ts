import {
  resolveWorkspaceCapabilities,
  wordpressApplyBlockedReason,
  wordpressConnectBlockedReason,
  wordpressSyncBlockedReason,
  type CapabilityFlags,
} from '@cerevex/contracts';

export function wordpressFlagsFromStore(store: { config?: Record<string, unknown> } | null | undefined): CapabilityFlags {
  const workspace = store?.config && typeof store.config === 'object' ? (store.config as Record<string, unknown>).workspace : {};
  return resolveWorkspaceCapabilities(workspace && typeof workspace === 'object' ? workspace : {});
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
