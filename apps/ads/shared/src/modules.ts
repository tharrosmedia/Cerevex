import {
  parseWorkspaceModuleSettings,
  resolveWorkspaceCapabilities,
  settingsJsonWithBusinessType,
  settingsJsonWithModuleOverrides,
  type BusinessType,
  type CapabilityFlags,
  type ModuleFlags,
  type WorkspaceModuleSettings,
} from "@shopify-brain/contracts";

export {
  ADS_MODULE_IDS,
  BUSINESS_TYPE_HELP,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  MODULE_COPY,
  defaultModulesFor,
  filterItemsByModules,
  isBusinessType,
  parseWorkspaceModuleSettings,
  unboardedModules,
} from "@shopify-brain/contracts";
export type { AdsModuleId, BusinessType, ModuleFlags, WorkspaceModuleSettings } from "@shopify-brain/contracts";

export function asSettingsRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

export function readWorkspaceModules(settingsJson: unknown): WorkspaceModuleSettings {
  return parseWorkspaceModuleSettings(asSettingsRecord(settingsJson));
}

export function applyBusinessTypeSettings(
  settingsJson: unknown,
  businessType: BusinessType,
  completedAt = new Date().toISOString(),
): Record<string, unknown> {
  return settingsJsonWithBusinessType(asSettingsRecord(settingsJson), businessType, completedAt);
}

export function applyModuleOverrideSettings(
  settingsJson: unknown,
  overrides: Partial<ModuleFlags>,
): Record<string, unknown> {
  return settingsJsonWithModuleOverrides(asSettingsRecord(settingsJson), overrides);
}

export function toWorkspaceSummary(row: {
  id: string;
  name: string;
  applyKillSwitch: boolean;
  settingsJson: unknown;
}): {
  id: string;
  name: string;
  applyKillSwitch: boolean;
  capabilities: CapabilityFlags;
} & WorkspaceModuleSettings {
  return {
    id: row.id,
    name: row.name,
    applyKillSwitch: row.applyKillSwitch,
    capabilities: resolveWorkspaceCapabilities(row.settingsJson),
    ...readWorkspaceModules(row.settingsJson),
  };
}
