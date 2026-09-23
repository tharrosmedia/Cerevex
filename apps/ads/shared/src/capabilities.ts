/**
 * Workspace capability helpers. Browser-safe (process.env only).
 */

import {
  applyEnvKills,
  capabilityBlockMessage,
  defaultCapabilityFlags,
  isCapabilityOn,
  isCapabilityVisible,
  isCapabilityWritable,
  resolveWorkspaceCapabilities,
  settingsJsonWithCapabilityOverrides,
  type CapabilityFlags,
  type CapabilityId,
  type CapabilityOverrides,
} from "@shopify-brain/contracts";
import { asSettingsRecord } from "./modules";

export {
  CAPABILITY_CATALOG,
  CAPABILITY_CATALOG_LIST,
  CAPABILITY_IDS,
  CAPABILITY_STATES,
  applyEnvKills,
  capabilityBlockMessage,
  capabilityEnvKillKey,
  defaultCapabilityFlags,
  envCapabilityKills,
  filterItemsByCapabilities,
  isCapabilityId,
  isCapabilityOn,
  isCapabilityState,
  isCapabilityVisible,
  isCapabilityWritable,
  isLegacyAdsWebAllowed,
  isApplyEnabled,
  canApproveWithApply,
  legacyAdsWebGate,
  mergeCapabilityFlags,
  parseCapabilityOverrides,
  resolveWorkspaceCapabilities,
  settingsJsonWithCapabilityOverrides,
} from "@shopify-brain/contracts";
export type {
  CapabilityCatalogEntry,
  CapabilityFlags,
  CapabilityId,
  CapabilityOverrides,
  CapabilityState,
  LegacyAdsWebGate,
} from "@shopify-brain/contracts";

export function readWorkspaceCapabilities(settingsJson: unknown): CapabilityFlags {
  return resolveWorkspaceCapabilities(settingsJson);
}

export function applyCapabilityOverrideSettings(
  settingsJson: unknown,
  overrides: CapabilityOverrides,
): Record<string, unknown> {
  return settingsJsonWithCapabilityOverrides(asSettingsRecord(settingsJson), overrides);
}

export function workspaceCapabilityOn(settingsJson: unknown, id: CapabilityId): boolean {
  return isCapabilityOn(id, readWorkspaceCapabilities(settingsJson));
}

export function workspaceCapabilityVisible(settingsJson: unknown, id: CapabilityId): boolean {
  return isCapabilityVisible(id, readWorkspaceCapabilities(settingsJson));
}

export function workspaceCapabilityWritable(settingsJson: unknown, id: CapabilityId): boolean {
  return isCapabilityWritable(id, readWorkspaceCapabilities(settingsJson));
}

export function capabilityOffMessage(id: CapabilityId, flags: CapabilityFlags): string {
  return capabilityBlockMessage(id, flags[id]);
}

export function publicCapabilityView(settingsJson: unknown): {
  capabilities: CapabilityFlags;
  defaults: CapabilityFlags;
} {
  return {
    capabilities: applyEnvKills(readWorkspaceCapabilities(settingsJson)),
    defaults: defaultCapabilityFlags(),
  };
}
