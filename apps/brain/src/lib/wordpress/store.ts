import { decrypt, encrypt } from '../encryption';
import type { StoreConfig } from '../types/store';

export type WordpressStoreConfig = {
  siteUrl?: string;
  pluginKeyEnc?: string;
  connectedAt?: string;
  lastSyncedAt?: string;
  lastHealthAt?: string;
  lastHealthOk?: boolean;
  applyKillSwitch?: boolean;
  pluginVersion?: string;
};

export function storeConnectorType(store: { connector_type?: string; platform?: string } | null | undefined): string {
  return store?.connector_type || store?.platform || 'shopify';
}

export function isWordpressStore(store: { connector_type?: string; platform?: string } | null | undefined): boolean {
  return storeConnectorType(store) === 'wordpress';
}

export function wordpressConfigFromStore(store: { config?: StoreConfig | Record<string, unknown> } | null | undefined): WordpressStoreConfig {
  const config = (store?.config || {}) as Record<string, unknown>;
  const raw = config.wordpress;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as WordpressStoreConfig;
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

/** Kill switch defaults ON. Only an explicit `false` allows apply. */
export function wordpressKillSwitchIsOn(value: unknown): boolean {
  return value !== false;
}

export function workspaceWordpressKillSwitch(store: { config?: StoreConfig | Record<string, unknown> } | null | undefined): boolean {
  const workspace = asRecord(asRecord(store?.config).workspace);
  if (!Object.prototype.hasOwnProperty.call(workspace, 'wordpressApplyKillSwitch')) return false;
  return wordpressKillSwitchIsOn(workspace.wordpressApplyKillSwitch);
}

export function wordpressApplyBlockedByKillSwitch(store: { config?: StoreConfig | Record<string, unknown> } | null | undefined): boolean {
  const wp = wordpressConfigFromStore(store);
  if (workspaceWordpressKillSwitch(store)) return true;
  return wordpressKillSwitchIsOn(wp.applyKillSwitch);
}

export function decryptWordpressPluginKey(store: { shopify_access_token?: string; config?: StoreConfig | Record<string, unknown> } | null | undefined): string {
  const wp = wordpressConfigFromStore(store);
  const secret = process.env.ENCRYPTION_KEY || '';
  if (wp.pluginKeyEnc) {
    try {
      return decrypt(wp.pluginKeyEnc, secret);
    } catch {
      return '';
    }
  }
  return store?.shopify_access_token || '';
}

export function encryptWordpressPluginKey(pluginKey: string): string {
  return encrypt(pluginKey, process.env.ENCRYPTION_KEY || '');
}

export function wordpressSiteUrl(store: { shopify_domain?: string; config?: StoreConfig | Record<string, unknown> } | null | undefined): string {
  const wp = wordpressConfigFromStore(store);
  return wp.siteUrl || store?.shopify_domain || '';
}
