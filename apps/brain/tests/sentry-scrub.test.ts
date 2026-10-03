import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorEvent } from '@sentry/nextjs';
import type { TransactionEvent } from '@sentry/core';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '../lib/sentry-scrub';

const env = process.env as Record<string, string | undefined>;
const prevKey = env.ADS_INTERNAL_KEY;
env.ADS_INTERNAL_KEY = 'ads-internal-test-key';

try {
  const event: ErrorEvent = {
    type: undefined,
    message: 'failed with shpat_live123 and ya29.googleToken for adam@tharrosmedia.com',
    request: {
      url: 'https://console.example/api/gsc/oauth/callback?code=abc&state=xyz&ok=1',
      cookies: {
        auth: 'the-app-password',
        tharros_session: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
        locale: 'en',
      },
      headers: {
        Authorization: 'Bearer ya29.googleToken',
        Cookie: 'auth=the-app-password; tharros_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
        'Set-Cookie': 'auth=the-app-password',
        'X-Api-Key': 'header-key',
        'X-Cerevex-Internal-Key': 'ads-internal-test-key',
        Accept: 'application/json',
      },
      data: JSON.stringify({
        access_token: 'ya29.googleToken',
        refresh_token: '1//refresh',
        shopify_access_token: 'shpat_live123',
        ADS_INTERNAL_KEY: 'ads-internal-test-key',
        password: 'hunter2',
        note: 'see shpat_live123 and ads-internal-test-key adam@tharrosmedia.com',
      }),
      query_string: 'code=abc&state=xyz&ok=1',
    },
    extra: { authorization: 'Bearer x', nested: { apiKey: 'k' } },
    contexts: { response: { status_code: 500, headers: { 'set-cookie': 'a=b' } } },
    breadcrumbs: [{ data: { token: 't', url: '/settings?code=secret-code' } }],
    exception: {
      values: [{ type: 'Error', value: 'oauth failed for adam@tharrosmedia.com token=shpat_live123' }],
    },
    transaction: 'GET /api/gsc/oauth/callback?code=abc&state=signed-state',
  };

  const scrubbed = scrubSentryEvent(event);
  assert.equal(scrubbed.request?.headers?.Authorization, '[redacted]');
  assert.equal(scrubbed.request?.headers?.Cookie, '[redacted]');
  assert.equal(scrubbed.request?.headers?.['Set-Cookie'], '[redacted]');
  assert.equal(scrubbed.request?.headers?.['X-Api-Key'], '[redacted]');
  assert.equal(scrubbed.request?.headers?.['X-Cerevex-Internal-Key'], '[redacted]');
  assert.equal(scrubbed.request?.headers?.Accept, 'application/json');
  assert.equal(scrubbed.request?.cookies?.auth, '[redacted]');
  assert.equal(scrubbed.request?.cookies?.tharros_session, '[redacted]');
  assert.equal(scrubbed.request?.cookies?.locale, 'en');
  assert.equal(typeof scrubbed.request?.data, 'string');
  const body = JSON.parse(String(scrubbed.request?.data));
  assert.equal(body.access_token, '[redacted]');
  assert.equal(body.refresh_token, '[redacted]');
  assert.equal(body.shopify_access_token, '[redacted]');
  assert.equal(body.ADS_INTERNAL_KEY, '[redacted]');
  assert.equal(body.password, '[redacted]');
  assert.equal(String(body.note).includes('shpat_live123'), false);
  assert.equal(String(body.note).includes('ads-internal-test-key'), false);
  assert.equal(String(body.note).includes('adam@tharrosmedia.com'), false);
  assert.equal(String(scrubbed.request?.url).includes('code=abc'), false);
  assert.equal(String(scrubbed.request?.url).includes('state=xyz'), false);
  assert.equal(String(scrubbed.request?.url).includes('ok=1'), true);
  assert.equal(String(scrubbed.request?.query_string).includes('code='), true);
  assert.equal(String(scrubbed.request?.query_string).includes('abc'), false);
  assert.equal(scrubbed.extra?.authorization, '[redacted]');
  assert.equal((scrubbed.extra?.nested as { apiKey: string }).apiKey, '[redacted]');
  assert.equal(scrubbed.contexts?.response?.status_code, 500);
  assert.equal(scrubbed.exception?.values?.[0]?.value?.includes('adam@tharrosmedia.com'), false);
  assert.equal(scrubbed.exception?.values?.[0]?.value?.includes('shpat_live123'), false);
  assert.equal(String(scrubbed.transaction).includes('code=abc'), false);
  assert.equal(String(scrubbed.transaction).includes('signed-state'), false);
  assert.equal(scrubbed.breadcrumbs?.[0]?.data?.token, '[redacted]');
  assert.equal(String(scrubbed.breadcrumbs?.[0]?.data?.url).includes('secret-code'), false);
  assert.equal(event.request?.headers?.Authorization, 'Bearer ya29.googleToken');
  assert.equal(String(scrubbed.message).includes('adam@tharrosmedia.com'), false);

  const transaction: TransactionEvent = {
    type: 'transaction',
    transaction: 'GET /callback?state=keep-me-out',
    request: { url: 'https://console.example/callback?state=keep-me-out' },
  };
  const scrubbedTxn = scrubSentryEvent(transaction);
  assert.equal(scrubbedTxn.type, 'transaction');
  assert.equal(String(scrubbedTxn.transaction).includes('keep-me-out'), false);
  assert.equal(String(scrubbedTxn.request?.url).includes('keep-me-out'), false);

  const crumb = scrubSentryBreadcrumb({ category: 'http', data: { refreshToken: 'r', url: '/api/health' } });
  assert.equal(crumb.data.refreshToken, '[redacted]');
  assert.equal(crumb.data.url, '/api/health');

  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of ['../sentry.server.config.ts', '../sentry.edge.config.ts', '../instrumentation-client.ts']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.match(src, /includeLocalVariables:\s*false/);
    assert.match(src, /sendDefaultPii:\s*false/);
    assert.match(src, /cookies:\s*false/);
    assert.match(src, /urlQueryParams:\s*false/);
    assert.match(src, /userInfo:\s*false/);
    assert.match(src, /beforeSendTransaction/);
    assert.match(src, /beforeSend/);
    assert.match(src, /beforeBreadcrumb/);
    assert.doesNotMatch(src, /includeLocalVariables:\s*true/);
  }

  console.log('sentry-scrub: ok');
} finally {
  if (prevKey === undefined) delete env.ADS_INTERNAL_KEY;
  else env.ADS_INTERNAL_KEY = prevKey;
}
