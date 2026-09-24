import {
  gscApplyBlockedReason,
  isGscApplyWritable,
  isGscRecommendationsOn,
  isGscRecommendationsVisible,
  resolveWorkspaceCapabilities,
  type CapabilityFlags,
} from '@cerevex/contracts';
import { gscApplyBlockedByKillSwitch } from './gsc-threshold';

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function gscWorkspaceSettingsFromStore(
  store: { config?: Record<string, unknown> } | null | undefined,
): Record<string, unknown> {
  return asRecord(asRecord(store?.config).workspace);
}

export function gscFlagsFromStore(store: { config?: Record<string, unknown> } | null | undefined): CapabilityFlags {
  return resolveWorkspaceCapabilities(gscWorkspaceSettingsFromStore(store));
}

export function gscRecommendationsAreVisible(store: { config?: Record<string, unknown> } | null | undefined): boolean {
  return isGscRecommendationsVisible(gscFlagsFromStore(store));
}

export function gscRecommendationsCanGenerate(store: { config?: Record<string, unknown> } | null | undefined): boolean {
  const flags = gscFlagsFromStore(store);
  return isGscRecommendationsOn(flags) || flags['seo.gsc.recommendations'] === 'recommend_only';
}

export function gscApplyWriteBlockedReason(store: { config?: Record<string, unknown> } | null | undefined): string | null {
  const flags = gscFlagsFromStore(store);
  const flagBlock = gscApplyBlockedReason(flags);
  if (flagBlock) return flagBlock;
  if (gscApplyBlockedByKillSwitch(store)) return 'gsc_apply_kill_switch';
  return null;
}

export function gscApplyIsWritable(store: { config?: Record<string, unknown> } | null | undefined): boolean {
  return isGscApplyWritable(gscFlagsFromStore(store)) && !gscApplyBlockedByKillSwitch(store);
}

export function isGscSourcedJob(input: { source?: unknown; gscRecType?: unknown } | null | undefined): boolean {
  if (!input) return false;
  if (input.source === 'gsc') return true;
  return typeof input.gscRecType === 'string' && input.gscRecType.startsWith('gsc_');
}
