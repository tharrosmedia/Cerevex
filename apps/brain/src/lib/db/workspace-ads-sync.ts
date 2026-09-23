import type {
  BusinessType,
  CapabilityOverrides,
  ModuleFlags,
} from '@shopify-brain/contracts';

export type AdsWorkspaceSettingsPatch = {
  businessType?: BusinessType;
  modules?: Partial<ModuleFlags>;
  capabilities?: CapabilityOverrides;
};

/**
 * Same PATCH /workspace body ads-web Settings and Capabilities already send.
 * Returns null when there is nothing to write (API rejects empty patches).
 */
export function adsWorkspaceSettingsPatch(
  input: AdsWorkspaceSettingsPatch,
): AdsWorkspaceSettingsPatch | null {
  const body: AdsWorkspaceSettingsPatch = {};
  if (input.businessType) body.businessType = input.businessType;
  if (input.modules && Object.keys(input.modules).length > 0) body.modules = input.modules;
  if (input.capabilities && Object.keys(input.capabilities).length > 0) {
    body.capabilities = input.capabilities;
  }
  return Object.keys(body).length > 0 ? body : null;
}
