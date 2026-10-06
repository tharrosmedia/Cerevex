import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import {
  isWordpressConnectVisible,
  wordpressApplyBlockedReason,
  wordpressConnectBlockedReason,
  wordpressSyncBlockedReason,
} from '@cerevex/contracts';
import { middleware } from '../middleware';
import { WordpressAddSiteDownload } from '../components/wordpress-add-site-download';
import { wordpressPluginDownloadResponse } from '../app/api/wordpress/plugin/route';
import {
  WORDPRESS_CONNECT_OFF_REASON,
  WORDPRESS_CONNECT_SETTINGS_HREF,
} from '../src/lib/wordpress/connect-copy';
import {
  WORDPRESS_CONNECT_SETTINGS_TIMEOUT_MS,
  wordpressConnectFlagsForAddSite,
  wordpressFlagsFromStore,
} from '../src/lib/wordpress/capabilities';
import { newWordpressStoreConfig } from '../src/lib/wordpress/connect-config';
import { pluginDownloadError } from '../src/lib/wordpress/plugin-download';

const root = dirname(fileURLToPath(import.meta.url));

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const hiddenStore = {
  config: {
    workspace: {
      capabilities: {
        'site.wordpress.connect': 'hidden' as const,
        'site.wordpress.sync': 'hidden' as const,
        'site.wordpress.apply': 'hidden' as const,
      },
    },
  },
};

const storeCopyOn = {
  config: {
    workspace: {
      capabilities: {
        'site.wordpress.connect': 'on' as const,
        'site.wordpress.sync': 'hidden' as const,
        'site.wordpress.apply': 'on' as const,
      },
    },
  },
};

const workspaceOn = await wordpressConnectFlagsForAddSite(hiddenStore, {
  readProductSettings: async () => ({
    capabilities: {
      'site.wordpress.connect': 'on',
      'site.wordpress.sync': 'on',
      'site.wordpress.apply': 'on',
    },
  }),
});
assert.equal(workspaceOn['site.wordpress.connect'], 'on');
assert.equal(workspaceOn['site.wordpress.sync'], 'hidden', 'sync stays on the selected store');
assert.equal(workspaceOn['site.wordpress.apply'], 'hidden', 'apply stays on the selected store');
assert.equal(isWordpressConnectVisible(workspaceOn), true);
assert.equal(wordpressConnectBlockedReason(workspaceOn), null);
assert.equal(wordpressSyncBlockedReason(wordpressFlagsFromStore(hiddenStore)), 'capability_site_wordpress_sync');
assert.equal(wordpressApplyBlockedReason(wordpressFlagsFromStore(hiddenStore)), 'capability_site_wordpress_apply');

const allowed = await wordpressPluginDownloadResponse(workspaceOn);
assert.equal(allowed.status, 200);
assert.equal(allowed.headers.get('content-type'), 'application/zip');
const downloaded = new Uint8Array(await allowed.arrayBuffer());
const committed = await readFile(join(root, '../artifacts/cerevex-wordpress.zip'));
assert.equal(sha256(downloaded), sha256(committed));
assert.equal(downloaded.length, committed.length);

const workspaceHidden = await wordpressConnectFlagsForAddSite(storeCopyOn, {
  readProductSettings: async () => ({
    capabilities: { 'site.wordpress.connect': 'hidden' },
  }),
});
assert.equal(isWordpressConnectVisible(workspaceHidden), false);
assert.equal(wordpressConnectBlockedReason(workspaceHidden), 'capability_site_wordpress_connect');
assert.equal(workspaceHidden['site.wordpress.sync'], 'hidden');
const denied = await wordpressPluginDownloadResponse(workspaceHidden);
assert.equal(denied.status, 404);
const deniedBody = await denied.json() as { ok?: boolean; reason?: string; settingsHref?: string };
assert.equal(deniedBody.ok, false);
assert.equal(deniedBody.reason, WORDPRESS_CONNECT_OFF_REASON);
assert.equal(deniedBody.settingsHref, WORDPRESS_CONNECT_SETTINGS_HREF);
const deniedText = JSON.stringify(deniedBody);
assert.equal(/token|pluginKey|secret|shpat_|https?:\/\//i.test(deniedText), false);

const offHtml = renderToStaticMarkup(createElement(WordpressAddSiteDownload, { visible: false }));
assert.equal(visibleText(offHtml), WORDPRESS_CONNECT_OFF_REASON);
assert.match(offHtml, /href="\/settings#modules"/);
assert.equal(offHtml.includes('In-app download'), false);
assert.equal(offHtml.includes('/api/wordpress/plugin'), false);
const onHtml = renderToStaticMarkup(createElement(WordpressAddSiteDownload, { visible: true }));
assert.match(onHtml, /In-app download/);
assert.match(onHtml, /href="\/api\/wordpress\/plugin"/);

const storesPage = readFileSync(join(root, '../app/stores/page.tsx'), 'utf8');
assert.match(storesPage, /<WordpressAddSiteDownload visible \/>/);
assert.match(storesPage, /<WordpressAddSiteDownload visible=\{false\} \/>/);
assert.equal(storesPage.includes('WordpressPluginDownload'), false);
assert.match(storesPage, /wordpressConnectFlagsForAddSite/);

const settingsSrc = readFileSync(join(root, '../components/wordpress-connect-settings.tsx'), 'utf8');
assert.match(settingsSrc, /wordpressConnectFlagsForAddSite\(store\)/);
assert.match(settingsSrc, /isWordpressConnectVisible\(connectFlags\)/);
assert.match(settingsSrc, /isWordpressSyncWritable\(gateFlags\)/);
assert.match(settingsSrc, /isWordpressApplyWritable\(gateFlags\)/);
assert.equal(settingsSrc.includes('isWordpressSyncWritable(connectFlags)'), false);
assert.equal(settingsSrc.includes('isWordpressApplyWritable(connectFlags)'), false);

assert.equal(WORDPRESS_CONNECT_SETTINGS_TIMEOUT_MS, 1500);
const modulesSrc = readFileSync(join(root, '../src/lib/db/workspace-modules.ts'), 'utf8');
assert.match(modulesSrc, /setTimeout\(\(\) => resolve\(null\), 1500\)/);
const capabilitiesSrc = readFileSync(join(root, '../src/lib/wordpress/capabilities.ts'), 'utf8');
assert.match(capabilitiesSrc, /getWorkspaceProductSettings\(\)/);

const started = Date.now();
const timedOutOn = await wordpressConnectFlagsForAddSite(storeCopyOn, {
  timeoutMs: 40,
  readProductSettings: () => new Promise(() => {}),
});
assert.ok(Date.now() - started < 400, 'timeout uses the store copy without waiting out a hung ads-api');
assert.equal(timedOutOn['site.wordpress.connect'], 'on');
assert.equal(wordpressConnectBlockedReason(timedOutOn), null);

const lateStart = Date.now();
const timedOutHidden = await wordpressConnectFlagsForAddSite(hiddenStore, {
  timeoutMs: 40,
  readProductSettings: () => new Promise((resolve) => {
    setTimeout(() => resolve({ capabilities: { 'site.wordpress.connect': 'on' } }), 300);
  }),
});
assert.ok(Date.now() - lateStart < 250);
assert.equal(timedOutHidden['site.wordpress.connect'], 'hidden');
assert.equal(wordpressConnectBlockedReason(timedOutHidden), 'capability_site_wordpress_connect');

const adsDown = await wordpressConnectFlagsForAddSite(storeCopyOn, {
  readProductSettings: async () => {
    throw new Error('ads-api down');
  },
});
assert.equal(adsDown['site.wordpress.connect'], 'on');

const emptyAnswer = await wordpressConnectFlagsForAddSite(hiddenStore, {
  readProductSettings: async () => ({ capabilities: {} }),
});
assert.equal(emptyAnswer['site.wordpress.connect'], 'hidden');

const env = process.env as Record<string, string | undefined>;
const previousPassword = env.APP_PASSWORD;
env.APP_PASSWORD = 'console-secret';
try {
  const signedOut = await middleware(new NextRequest('http://localhost/api/wordpress/plugin', { method: 'GET' }));
  assert.equal(signedOut.status, 401);
  const signedIn = await middleware(new NextRequest('http://localhost/api/wordpress/plugin', {
    method: 'GET',
    headers: { cookie: 'auth=console-secret' },
  }));
  assert.notEqual(signedIn.status, 401);
} finally {
  if (previousPassword === undefined) delete env.APP_PASSWORD;
  else env.APP_PASSWORD = previousPassword;
}

const syncSrc = readFileSync(join(root, '../src/lib/wordpress/sync.ts'), 'utf8');
const applySrc = readFileSync(join(root, '../src/lib/wordpress/apply.ts'), 'utf8');
assert.match(syncSrc, /wordpressFlagsFromStore\(store\)/);
assert.equal(syncSrc.includes('wordpressConnectFlagsForAddSite'), false);
assert.equal(syncSrc.includes('getWorkspaceProductSettings'), false);
assert.match(applySrc, /wordpressApplyGateReason/);
assert.equal(applySrc.includes('wordpressConnectFlagsForAddSite'), false);
assert.equal(applySrc.includes('getWorkspaceProductSettings'), false);

const connectSrc = readFileSync(join(root, '../src/lib/wordpress/connect.ts'), 'utf8');
const connectFn = connectSrc.slice(
  connectSrc.indexOf('export async function connectWordpressStore'),
  connectSrc.indexOf('export async function disconnectWordpressStore'),
);
const gateAt = connectFn.indexOf('wordpressConnectFlagsForAddSite');
const probeAt = connectFn.indexOf('testWordpressConnection');
assert.ok(gateAt >= 0 && probeAt > gateAt);
assert.match(connectFn, /wordpressConnectBlockedFromSource\(\{ workspaceSettings, store \}\)/);
assert.match(connectFn, /newWordpressStoreConfig\(\{ wordpress \}\)/);
assert.match(
  connectSrc.slice(connectSrc.indexOf('export async function disconnectWordpressStore')),
  /wordpressFlagsFromStore\(store\)/,
);

const seeded = newWordpressStoreConfig({
  wordpress: { siteUrl: 'https://kc.example', pluginKeyEnc: 'enc' },
});
assert.equal(seeded.wordpress.applyKillSwitch, true);
assert.equal(Object.prototype.hasOwnProperty.call(seeded, 'workspace'), false);

assert.equal(
  await pluginDownloadError(new Response(null, { status: 404 })),
  WORDPRESS_CONNECT_OFF_REASON,
);

console.log('wordpress-connect-gate: ok');
