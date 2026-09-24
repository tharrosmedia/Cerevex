import {
  resolveWorkspaceCapabilities,
  wordpressApplyBlockedReason,
  wordpressConnectBlockedReason,
  wordpressSyncBlockedReason,
  type CapabilityFlags,
} from '@cerevex/contracts';

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
  return wordpressFlagsFromWorkspace(wordpressWorkspaceSettingsFromStore(store));
}

export function wordpressConnectBlockedFromWorkspace(workspaceSettings: unknown): string | null {
  return wordpressConnectBlockedReason(wordpressFlagsFromWorkspace(workspaceSettings));
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
