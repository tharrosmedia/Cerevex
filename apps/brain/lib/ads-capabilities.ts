import {
  defaultCapabilityFlags,
  isCapabilityOn,
  isCapabilityVisible,
  isCapabilityWritable,
  resolveWorkspaceCapabilities,
  type CapabilityFlags,
  type CapabilityId,
} from '@cerevex/contracts';
import type { AdsWorkspace } from './ads-bff';

export function capabilitiesFromWorkspace(workspace: AdsWorkspace | null | undefined): CapabilityFlags {
  if (workspace?.capabilities) return workspace.capabilities;
  return resolveWorkspaceCapabilities({});
}

export function adsCapabilityOn(workspace: AdsWorkspace | null | undefined, id: CapabilityId): boolean {
  return isCapabilityOn(id, capabilitiesFromWorkspace(workspace));
}

export function adsCapabilityVisible(workspace: AdsWorkspace | null | undefined, id: CapabilityId): boolean {
  return isCapabilityVisible(id, capabilitiesFromWorkspace(workspace));
}

export function adsCapabilityWritable(workspace: AdsWorkspace | null | undefined, id: CapabilityId): boolean {
  return isCapabilityWritable(id, capabilitiesFromWorkspace(workspace));
}

export { defaultCapabilityFlags, isCapabilityOn, isCapabilityVisible, isCapabilityWritable };
