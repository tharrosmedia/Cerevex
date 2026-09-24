import { cookies } from 'next/headers';
import { siteCmsPlainError, wordpressConnectBlockedReason } from '@cerevex/contracts';
import { createWordPressConnector, normalizeSiteUrl } from '@cerevex/connector-wordpress';
import { createStore, getStore, updateStore } from '../db/stores';
import { logEvent } from '../brain/events';
import { wordpressFlagsFromStore } from './capabilities';
import {
  encryptWordpressPluginKey,
  isWordpressStore,
  wordpressConfigFromStore,
} from './store';

export type WordpressConnectInput = {
  storeId?: string | null;
  name?: string;
  siteUrl: string;
  pluginKey: string;
};

export type WordpressConnectResult = {
  ok: boolean;
  storeId?: string;
  code?: string;
  reason?: string;
  connected?: boolean;
};

export async function testWordpressConnection(input: { siteUrl: string; pluginKey: string }): Promise<WordpressConnectResult> {
  try {
    const connector = createWordPressConnector({
      siteUrl: input.siteUrl,
      pluginKey: input.pluginKey,
    });
    const health = await connector.health();
    if (!health.ok) {
      return { ok: false, connected: false, code: health.code, reason: health.reason || siteCmsPlainError(health.code) };
    }
    return { ok: true, connected: true, reason: 'Connected' };
  } catch {
    return { ok: false, connected: false, code: 'unreachable', reason: siteCmsPlainError('unreachable') };
  }
}

export async function connectWordpressStore(input: WordpressConnectInput): Promise<WordpressConnectResult> {
  try {
    const siteUrl = normalizeSiteUrl(input.siteUrl);
    const pluginKey = input.pluginKey.trim();
    if (!siteUrl || !pluginKey) {
      return { ok: false, code: 'invalid_payload', reason: 'Paste the site URL and plugin key.' };
    }

    let store = input.storeId ? await getStore(input.storeId) : null;
    const flagsStore = store;
    const blocked = wordpressConnectBlockedReason(wordpressFlagsFromStore(flagsStore));
    if (blocked) {
      return { ok: false, code: 'capability_off', reason: siteCmsPlainError('capability_off') };
    }

    const tested = await testWordpressConnection({ siteUrl, pluginKey });
    if (!tested.ok) return tested;

    const encrypted = encryptWordpressPluginKey(pluginKey);
    const name = (input.name || '').trim() || hostLabel(siteUrl);
    const wordpress = {
      ...wordpressConfigFromStore(store),
      siteUrl,
      pluginKeyEnc: encrypted,
      connectedAt: new Date().toISOString(),
      lastHealthAt: new Date().toISOString(),
      lastHealthOk: true,
    };

    if (store && isWordpressStore(store)) {
      await updateStore(store.id, {
        name: name || store.name,
        shopify_domain: siteUrl,
        shopify_access_token: pluginKey,
        platform: 'wordpress',
        connector_type: 'wordpress',
        config: { ...(store.config || {}), wordpress },
      });
      await logEvent(store.id, 'human', 'wordpress.connected', { siteUrl, reconnect: true });
      return { ok: true, storeId: store.id, connected: true, reason: 'Connected' };
    }

    const created = await createStore({
      name,
      shopify_domain: siteUrl,
      shopify_access_token: pluginKey,
      platform: 'wordpress',
      connector_type: 'wordpress',
      config: { wordpress },
    });
    const jar = await cookies();
    jar.set('activeStoreId', created.id, {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    await logEvent(created.id, 'human', 'wordpress.connected', { siteUrl, reconnect: false });
    return { ok: true, storeId: created.id, connected: true, reason: 'Connected' };
  } catch (error) {
    console.warn('[wordpress.connect] degraded', error);
    return { ok: false, code: 'plugin_down', reason: siteCmsPlainError('plugin_down') };
  }
}

export async function disconnectWordpressStore(storeId: string): Promise<WordpressConnectResult> {
  try {
    const store = await getStore(storeId);
    if (!store) {
      return { ok: false, code: 'not_configured', reason: siteCmsPlainError('not_configured') };
    }
    const blocked = wordpressConnectBlockedReason(wordpressFlagsFromStore(store));
    if (blocked) {
      return { ok: false, code: 'capability_off', reason: siteCmsPlainError('capability_off') };
    }
    const current = { ...(store.config || {}) } as Record<string, unknown>;
    const previous = wordpressConfigFromStore(store);
    current.wordpress = {
      siteUrl: previous.siteUrl,
      applyKillSwitch: previous.applyKillSwitch,
      lastSyncedAt: previous.lastSyncedAt,
      disconnectedAt: new Date().toISOString(),
    };
    await updateStore(store.id, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: 'wordpress',
      connector_type: 'wordpress',
      config: current,
      clearToken: true,
    });
    await logEvent(store.id, 'human', 'wordpress.disconnected', { siteUrl: previous.siteUrl });
    return { ok: true, storeId: store.id, connected: false, reason: 'Disconnected. Review history was kept.' };
  } catch (error) {
    console.warn('[wordpress.disconnect] degraded', error);
    return { ok: false, code: 'plugin_down', reason: "Couldn't disconnect WordPress. Try again." };
  }
}

function hostLabel(siteUrl: string): string {
  try {
    return new URL(siteUrl).host || 'WordPress site';
  } catch {
    return 'WordPress site';
  }
}
