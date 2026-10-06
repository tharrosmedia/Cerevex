import {
  BUSINESS_TYPE_LABELS,
  parseWorkspaceModuleSettings,
  settingsJsonWithBusinessType,
  type BusinessType,
  type WorkspaceModuleSettings,
} from '@cerevex/contracts';
import { stripEditableWorkspaceSettings } from '../ads-confirmed-safety';

/** Q2: a client is a home-service business or an online store. Agency is the shared ads workspace. */
export const CLIENT_BUSINESS_TYPES = ['home_service', 'ecommerce'] as const;
export type ClientBusinessType = (typeof CLIENT_BUSINESS_TYPES)[number];

export const CLIENT_BUSINESS_TYPE_LABELS: Record<ClientBusinessType, string> = {
  home_service: 'Home-service business',
  ecommerce: 'Online store',
};

export function isClientBusinessType(value: unknown): value is ClientBusinessType {
  return value === 'home_service' || value === 'ecommerce';
}

export function clientBusinessTypeLabel(type: BusinessType): string {
  if (isClientBusinessType(type)) return CLIENT_BUSINESS_TYPE_LABELS[type];
  return BUSINESS_TYPE_LABELS[type];
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** New Shopify store: no business type, modules, or copied workspace keys. */
export function emptyClientWorkspaceConfig(): { workspace: Record<string, never> } {
  return { workspace: {} };
}

function workspaceOnStore(store: { config?: unknown } | null | undefined): Record<string, unknown> {
  const config = asRecord(store?.config);
  return asRecord(config.workspace);
}

/**
 * Cookie settings are the source only when there is no store.
 * A store with no businessType is "not set" (Ads redirects to onboarding).
 */
export function resolveWorkspaceModuleSettings(input: {
  store: { config?: unknown } | null;
  cookie: Record<string, unknown> | null;
}): WorkspaceModuleSettings {
  if (input.store) return parseWorkspaceModuleSettings(workspaceOnStore(input.store));
  return parseWorkspaceModuleSettings(input.cookie ?? {});
}

/** Base record for a save. A store never inherits the cerevex_workspace cookie. */
export function settingsRecordForSave(input: {
  store: { config?: unknown } | null;
  cookie: Record<string, unknown> | null;
}): Record<string, unknown> {
  const raw = input.store ? workspaceOnStore(input.store) : { ...(input.cookie ?? {}) };
  return stripEditableWorkspaceSettings(raw);
}

export function nextWorkspaceForBusinessType(input: {
  businessType: ClientBusinessType;
  store: { config?: unknown } | null;
  cookie: Record<string, unknown> | null;
  completedAt?: string;
}): Record<string, unknown> {
  return settingsJsonWithBusinessType(
    settingsRecordForSave(input),
    input.businessType,
    input.completedAt,
  );
}

/**
 * Brain does not send businessType to the shared ads workspace.
 * That workspace stays agency. There is no PATCH body from a client type save.
 */
export function adsPatchForClientBusinessType(): null {
  return null;
}

export async function commitClientBusinessType(
  businessType: unknown,
  deps: {
    store: { config?: unknown } | null;
    cookie: Record<string, unknown> | null;
    completedAt?: string;
    persist: (next: Record<string, unknown>) => Promise<void>;
    patchAds: (body: { businessType?: BusinessType }) => Promise<unknown>;
  },
): Promise<WorkspaceModuleSettings> {
  if (!isClientBusinessType(businessType)) {
    throw new Error('Pick Home-service business or Online store.');
  }
  const next = nextWorkspaceForBusinessType({
    businessType,
    store: deps.store,
    cookie: deps.cookie,
    completedAt: deps.completedAt,
  });
  await deps.persist(next);
  const adsPatch = adsPatchForClientBusinessType();
  if (adsPatch) await deps.patchAds(adsPatch);
  return parseWorkspaceModuleSettings(next);
}
