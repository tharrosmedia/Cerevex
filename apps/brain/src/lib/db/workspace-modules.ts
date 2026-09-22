import { cookies } from 'next/headers';
import {
  parseWorkspaceModuleSettings,
  settingsJsonWithBusinessType,
  settingsJsonWithModuleOverrides,
  type BusinessType,
  type ModuleFlags,
  type WorkspaceModuleSettings,
} from '@shopify-brain/contracts';
import { getActiveStoreId, getStore, updateStore } from './stores';

export const WORKSPACE_COOKIE = 'cerevex_workspace';

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
  return parseWorkspaceModuleSettings(next);
}

export async function saveModuleOverrides(overrides: Partial<ModuleFlags>) {
  const current = await currentSettingsRecord();
  const next = settingsJsonWithModuleOverrides(current, overrides);
  await persistSettings(next);
  return parseWorkspaceModuleSettings(next);
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
