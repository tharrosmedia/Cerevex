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

export function workspaceWordpressKillSwitch(store: { config?: StoreConfig | Record<string, unknown> } | null | undefined): boolean {
  const config = (store?.config || {}) as Record<string, unknown>;
  const workspace = config.workspace;
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return false;
  return (workspace as Record<string, unknown>).wordpressApplyKillSwitch === true;
}

export function wordpressApplyBlockedByKillSwitch(store: { config?: StoreConfig | Record<string, unknown> } | null | undefined): boolean {
  const wp = wordpressConfigFromStore(store);
  return wp.applyKillSwitch === true || workspaceWordpressKillSwitch(store);
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
