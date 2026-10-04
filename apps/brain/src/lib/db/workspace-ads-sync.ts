import type {
  BusinessType,
  CapabilityOverrides,
  ModuleFlags,
} from '@cerevex/contracts';

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

/**
 * A 403 from ads is a refusal, not a saved change.
 * Other failures still fall back to the local settings copy.
 */
export function capabilityPatchShowsSaved(result: {
  ok: boolean;
  status?: number;
  reason?: string;
}): boolean {
  if (result.ok) return true;
  if (result.status === 403 || result.reason === "unauthorized") return false;
  return true;
}
