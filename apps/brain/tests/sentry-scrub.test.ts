import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '../lib/sentry-scrub';

const env = process.env as Record<string, string | undefined>;
const prevKey = env.ADS_INTERNAL_KEY;
env.ADS_INTERNAL_KEY = 'ads-internal-test-key';

try {
  const event = {
    message: 'failed with shpat_live123 and ya29.googleToken',
    request: {
      headers: {
        Authorization: 'Bearer ya29.googleToken',
        Cookie: 'auth=secret',
        'Set-Cookie': 'auth=secret',
        'X-Api-Key': 'header-key',
        'X-Cerevex-Internal-Key': 'ads-internal-test-key',
        Accept: 'application/json',
      },
      data: {
        access_token: 'ya29.googleToken',
        refresh_token: '1//refresh',
        shopify_access_token: 'shpat_live123',
        ADS_INTERNAL_KEY: 'ads-internal-test-key',
        password: 'hunter2',
        client_secret: 'secret',
        note: 'see shpat_live123 and ads-internal-test-key',
      },
    },
    extra: { authorization: 'Bearer x', nested: { apiKey: 'k' } },
    contexts: { response: { status: 500, headers: { 'set-cookie': 'a=b' } } },
    breadcrumbs: [{ data: { token: 't', path: '/settings' } }],
  };

  const scrubbed = scrubSentryEvent(event);
  assert.equal(scrubbed.request.headers.Authorization, '[redacted]');
  assert.equal(scrubbed.request.headers.Cookie, '[redacted]');
  assert.equal(scrubbed.request.headers['Set-Cookie'], '[redacted]');
  assert.equal(scrubbed.request.headers['X-Api-Key'], '[redacted]');
  assert.equal(scrubbed.request.headers['X-Cerevex-Internal-Key'], '[redacted]');
  assert.equal(scrubbed.request.headers.Accept, 'application/json');
  assert.equal(scrubbed.request.data.access_token, '[redacted]');
  assert.equal(scrubbed.request.data.refresh_token, '[redacted]');
  assert.equal(scrubbed.request.data.shopify_access_token, '[redacted]');
  assert.equal(scrubbed.request.data.ADS_INTERNAL_KEY, '[redacted]');
  assert.equal(scrubbed.request.data.password, '[redacted]');
  assert.equal(scrubbed.request.data.client_secret, '[redacted]');
  assert.equal(scrubbed.request.data.note.includes('shpat_live123'), false);
  assert.equal(scrubbed.request.data.note.includes('ads-internal-test-key'), false);
  assert.equal(scrubbed.extra.authorization, '[redacted]');
  assert.equal(scrubbed.extra.nested.apiKey, '[redacted]');
  assert.equal(scrubbed.contexts.response.status, 500);
  assert.equal(scrubbed.contexts.response.headers['set-cookie'], '[redacted]');
  assert.equal(scrubbed.breadcrumbs[0].data.token, '[redacted]');
  assert.equal(scrubbed.breadcrumbs[0].data.path, '/settings');
  assert.equal(event.request.headers.Authorization, 'Bearer ya29.googleToken');

  const crumb = scrubSentryBreadcrumb({ category: 'http', data: { refreshToken: 'r', url: '/api/health' } });
  assert.equal(crumb.data.refreshToken, '[redacted]');
  assert.equal(crumb.data.url, '/api/health');

  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of ['../sentry.server.config.ts', '../sentry.edge.config.ts', '../instrumentation-client.ts']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.match(src, /includeLocalVariables:\s*false/);
    assert.match(src, /beforeSend/);
    assert.match(src, /beforeBreadcrumb/);
    assert.doesNotMatch(src, /includeLocalVariables:\s*true/);
  }

  console.log('sentry-scrub: ok');
} finally {
  if (prevKey === undefined) delete env.ADS_INTERNAL_KEY;
  else env.ADS_INTERNAL_KEY = prevKey;
}
