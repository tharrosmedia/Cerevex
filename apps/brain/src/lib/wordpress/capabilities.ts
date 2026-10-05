import {
  resolveWorkspaceCapabilities,
  wordpressApplyBlockedReason,
  wordpressConnectBlockedReason,
  wordpressSyncBlockedReason,
  type CapabilityFlags,
} from '@cerevex/contracts';
import { authoritativeApplyOn } from '../ads-apply-gate';
import { flagsWithConfirmedSafety } from '../ads-confirmed-safety';

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

/** Local flags hide apply. Ads must say this workspace's gate is on, or the write stays blocked. */
export async function wordpressFlagsForGate(
  store: { config?: Record<string, unknown> } | null | undefined,
): Promise<CapabilityFlags> {
  const flags = wordpressFlagsFromStore(store);
  if (await authoritativeApplyOn('site.wordpress.apply')) flags['site.wordpress.apply'] = 'on';
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
