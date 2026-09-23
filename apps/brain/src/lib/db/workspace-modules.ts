import { cookies } from 'next/headers';
import {
  blockedUnfinishedCapabilityOns,
  parseWorkspaceModuleSettings,
  resolveWorkspaceCapabilities,
  settingsJsonWithBusinessType,
  settingsJsonWithCapabilityOverrides,
  settingsJsonWithModuleOverrides,
  type BusinessType,
  type CapabilityFlags,
  type CapabilityOverrides,
  type ModuleFlags,
  type WorkspaceModuleSettings,
} from '@cerevex/contracts';
import { adsApi } from '@/lib/ads-bff';
import { getActiveStoreId, getStore, updateStore } from './stores';
import {
  adsWorkspaceSettingsPatch,
  type AdsWorkspaceSettingsPatch,
} from './workspace-ads-sync';

export type WorkspaceProductSettings = WorkspaceModuleSettings & {
  capabilities: CapabilityFlags;
};

export const WORKSPACE_COOKIE = 'cerevex_workspace';

async function patchAdsWorkspaceSettings(input: AdsWorkspaceSettingsPatch) {
  const body = adsWorkspaceSettingsPatch(input);
  if (!body) {
    return {
      ok: false as const,
      reason: 'error' as const,
      message: 'businessType, modules, or capabilities is required',
      status: 400,
    };
  }
  return adsApi<{ workspace: { capabilities?: CapabilityFlags } | null }>('/workspace', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

async function readCookieSettings(): Promise<Record<string, unknown> | null> {
  const jar = await cookies();
  const raw = jar.get(WORKSPACE_COOKIE)?.value;
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeCookieSettings(settings: Record<string, unknown>) {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, JSON.stringify(settings), {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

async function getActiveStoreRow() {
  try {
    const storeId = await getActiveStoreId();
    if (!storeId) return null;
    return await getStore(storeId);
  } catch {
    return null;
  }
}

export async function getWorkspaceModuleSettings(): Promise<WorkspaceModuleSettings> {
  const store = await getActiveStoreRow();
  const fromStore = asRecord(store?.config).workspace;
  if (fromStore && typeof fromStore === 'object') {
    const parsed = parseWorkspaceModuleSettings(fromStore);
    if (parsed.businessType || parsed.onboardingCompletedAt) return parsed;
  }
  const fromCookie = await readCookieSettings();
  if (fromCookie) return parseWorkspaceModuleSettings(fromCookie);
  return parseWorkspaceModuleSettings({});
}

export async function saveBusinessType(businessType: BusinessType) {
  const current = await currentSettingsRecord();
  const next = settingsJsonWithBusinessType(current, businessType);
  await persistSettings(next);
  await patchAdsWorkspaceSettings({ businessType });
  return parseWorkspaceModuleSettings(next);
}

export async function saveModuleOverrides(overrides: Partial<ModuleFlags>) {
  const current = await currentSettingsRecord();
  const next = settingsJsonWithModuleOverrides(current, overrides);
  await persistSettings(next);
  await patchAdsWorkspaceSettings({ modules: overrides });
  return parseWorkspaceModuleSettings(next);
}

export async function saveCapabilityOverrides(overrides: CapabilityOverrides) {
  if (blockedUnfinishedCapabilityOns(overrides).length > 0) {
    throw new Error('Unfinished M5.1 capabilities cannot be turned on.');
  }
  const current = await currentSettingsRecord();
  const next = settingsJsonWithCapabilityOverrides(current, overrides);
  await persistSettings(next);
  const patched = await patchAdsWorkspaceSettings({ capabilities: overrides });
  if (patched.ok && patched.data.workspace?.capabilities) {
    return {
      ...parseWorkspaceModuleSettings(next),
      capabilities: patched.data.workspace.capabilities,
    };
  }
  return {
    ...parseWorkspaceModuleSettings(next),
    capabilities: resolveWorkspaceCapabilities(next),
  };
}

export async function getWorkspaceProductSettings(): Promise<WorkspaceProductSettings> {
  const modules = await getWorkspaceModuleSettings();
  const local = resolveWorkspaceCapabilities(await currentSettingsRecord());
  try {
    const fromApi = await Promise.race([
      adsApi<{ workspace: { capabilities?: CapabilityFlags } | null }>("/workspace"),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 1500);
      }),
    ]);
    const capabilities =
      fromApi && fromApi.ok && fromApi.data.workspace?.capabilities
        ? fromApi.data.workspace.capabilities
        : local;
    return { ...modules, capabilities };
  } catch {
    return { ...modules, capabilities: local };
  }
}

async function currentSettingsRecord(): Promise<Record<string, unknown>> {
  const store = await getActiveStoreRow();
  const fromStore = asRecord(asRecord(store?.config).workspace);
  if (Object.keys(fromStore).length > 0) return fromStore;
  return (await readCookieSettings()) ?? {};
}

async function persistSettings(next: Record<string, unknown>) {
  await writeCookieSettings(next);
  const store = await getActiveStoreRow();
  if (!store) return;
  const currentConfig = asRecord(store.config);
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: { ...currentConfig, workspace: next },
  });
}
