import {
  applySafetyOnIds,
  isApplySafetyCapability,
  type BusinessType,
  type CapabilityId,
  type CapabilityOverrides,
  type ModuleFlags,
} from '@cerevex/contracts';

export type AdsWorkspaceSettingsPatch = {
  workspaceId?: string;
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
  if (Object.keys(body).length === 0) return null;
  if (input.workspaceId) body.workspaceId = input.workspaceId;
  return body;
}

/** True only when ads returned this workspace, this owner, and every requested gate on. */
export function ownerCapabilitySaveConfirmed(input: {
  result: { ok: boolean; data?: unknown };
  workspaceId: string;
  ownerUserId: string;
  capabilityIds: string[];
}): boolean {
  if (!input.result.ok || !input.workspaceId || !input.ownerUserId || input.capabilityIds.length === 0) return false;
  const data = input.result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const body = data as {
    workspace?: { id?: unknown; capabilities?: Record<string, unknown> };
    ownerUserId?: unknown;
  };
  if (!body.workspace || typeof body.workspace !== "object" || Array.isArray(body.workspace)) return false;
  if (body.workspace.id !== input.workspaceId) return false;
  if (body.ownerUserId !== input.ownerUserId) return false;
  const caps = body.workspace.capabilities;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return false;
  return input.capabilityIds.every((id) => caps[id] === "on");
}

function applySafetyOff(overrides?: Partial<Record<string, string>> | null): boolean {
  if (!overrides) return false;
  return Object.entries(overrides).some(
    ([id, state]) => isApplySafetyCapability(id as CapabilityId) && state !== "on" && state != null,
  );
}

/**
 * A 403 from ads is a refusal, not a saved change.
 * Other failures still fall back to the local settings copy, except an apply-safety on.
 * Those ons are saved only when ads accepted the patch.
 */
export function capabilityPatchShowsSaved(
  result: {
    ok: boolean;
    status?: number;
    reason?: string;
  },
  overrides?: Partial<Record<string, string>> | null,
): boolean {
  if (applySafetyOnIds(overrides).length > 0) return result.ok;
  if (applySafetyOff(overrides) && (result.status === 401 || result.status === 403)) return true;
  if (result.ok) return true;
  if (result.status === 403 || result.reason === "unauthorized") return false;
  return true;
}

/** Safety ons go out as the owner. The service key is omitted so ads can audit the owner. */
export function adsCallerHeaders(input: {
  safetyOn: boolean;
  internalKey?: string | null;
  ownerToken?: string | null;
}): Headers {
  const headers = new Headers();
  if (input.safetyOn) {
    const token = input.ownerToken?.trim();
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  }
  const key = input.internalKey?.trim();
  if (key) headers.set('x-cerevex-internal-key', key);
  const token = input.ownerToken?.trim();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}
