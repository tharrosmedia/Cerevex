import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import type { ErrorEvent, TransactionEvent } from '@sentry/core';
import {
  safeScrubSentryEvent,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  sentryScrubHooks,
} from '../lib/sentry-scrub';

const env = process.env as Record<string, string | undefined>;
const prevKey = env.ADS_INTERNAL_KEY;
const prevPassword = env.APP_PASSWORD;
const prevEncryption = env.ENCRYPTION_KEY;
const prevGsc = env.GSC_OAUTH_STATE_SECRET;
env.ADS_INTERNAL_KEY = 'ads-internal-test-key';
env.APP_PASSWORD = 'the-app-password-value';
env.ENCRYPTION_KEY = 'encryption-key-value';
env.GSC_OAUTH_STATE_SECRET = 'gsc-state-secret-value';

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
  assert.equal(String(scrubbedTxn.transaction).startsWith('GET /callback?'), true);
  assert.equal(String(scrubbedTxn.transaction).includes('keep-me-out'), false);
  assert.equal(String(scrubbedTxn.request?.url).includes('keep-me-out'), false);

  const crumb = scrubSentryBreadcrumb({ category: 'http', data: { refreshToken: 'r', url: '/api/health' } });
  assert.equal(crumb.data.refreshToken, '[redacted]');
  assert.equal(crumb.data.url, '/api/health');

  const queryCrumb = scrubSentryBreadcrumb({
    category: 'console',
    message: 'console leaked the-app-password-value',
    data: {
      'http.query': 'code=oauth-code&state=oauth-state&email=adam%40tharrosmedia.com',
      'http.fragment': 'token=frag-token',
    },
  });
  const queryDump = JSON.stringify(queryCrumb);
  assert.equal(queryDump.includes('the-app-password-value'), false);
  assert.equal(queryDump.includes('oauth-code'), false);
  assert.equal(queryDump.includes('oauth-state'), false);
  assert.equal(queryDump.includes('adam%40'), false);
  assert.equal(queryDump.includes('adam@'), false);
  assert.equal(queryDump.includes('frag-token'), false);

  const leaked = scrubSentryEvent({
    message: 'open https://console.example/cb?code=oauth-code&client_secret=sec-value&state=oauth-state refresh_token=1//refreshvalue encryption-key-value',
    exception: { values: [{ type: 'Error', value: 'boom the-app-password-value gsc-state-secret-value' }] },
  });
  const leakedDump = JSON.stringify(leaked);
  assert.equal(leakedDump.includes('oauth-code'), false);
  assert.equal(leakedDump.includes('sec-value'), false);
  assert.equal(leakedDump.includes('oauth-state'), false);
  assert.equal(leakedDump.includes('refreshvalue'), false);
  assert.equal(leakedDump.includes('the-app-password-value'), false);
  assert.equal(leakedDump.includes('encryption-key-value'), false);
  assert.equal(leakedDump.includes('gsc-state-secret-value'), false);

  const pathUrl = [
    'https://console.example',
    env.APP_PASSWORD,
    'adam@tharrosmedia.com',
    'shpat_live999',
    env.ADS_INTERNAL_KEY,
    env.ENCRYPTION_KEY,
    env.GSC_OAUTH_STATE_SECRET,
  ].join('/');
  const pathEvent = scrubSentryEvent({
    request: { url: pathUrl },
    transaction: `GET /cb/${env.ADS_INTERNAL_KEY}`,
    breadcrumbs: [{ data: { url: pathUrl } }],
    spans: [{ description: `GET ${pathUrl}`, data: { url: pathUrl } }],
    extra: { 'the-app-password-value': 'kept-value', note: 'next%3Fcode%3Doauth-code tail%26token%3Dsecrettoken' },
  });
  env.ENCRYPTION_KEY = 'AbCDef1234';
  const hexEvent = scrubSentryEvent({ message: 'leak abcdef1234 and AbCDef1234' });
  env.ENCRYPTION_KEY = 'encryption-key-value';
  const pathDump = JSON.stringify(pathEvent) + JSON.stringify(hexEvent);
  for (const secret of [
    'the-app-password-value',
    'ads-internal-test-key',
    'encryption-key-value',
    'gsc-state-secret-value',
    'adam@tharrosmedia.com',
    'shpat_live999',
    'oauth-code',
    'secrettoken',
    'abcdef1234',
    'AbCDef1234',
  ]) {
    assert.equal(pathDump.includes(secret), false, secret);
  }

  const cyclic: Record<string, unknown> = {
    type: 'transaction',
    transaction: 'middleware',
    message: 'edge the-app-password-value',
  };
  cyclic.self = cyclic;
  let deep: Record<string, unknown> = { message: 'leaf the-app-password-value' };
  for (let i = 0; i < 40; i += 1) deep = { child: deep };
  cyclic.extra = deep;
  class SdkClient {}
  const sdkClient = new SdkClient();
  cyclic.sdkProcessingMetadata = {
    client: sdkClient,
    dynamicSamplingContext: { trace_id: 'trace-kept-123' },
    normalizedRequest: cyclic,
  };
  const scrubbedCycle = scrubSentryEvent(cyclic) as {
    sdkProcessingMetadata?: {
      client?: unknown;
      dynamicSamplingContext?: { trace_id?: string };
      normalizedRequest?: unknown;
    };
  };
  assert.equal(scrubbedCycle.sdkProcessingMetadata?.client, sdkClient);
  assert.equal(scrubbedCycle.sdkProcessingMetadata?.dynamicSamplingContext?.trace_id, 'trace-kept-123');
  assert.notEqual(scrubbedCycle.sdkProcessingMetadata?.normalizedRequest, cyclic);
  assert.equal(JSON.stringify(scrubbedCycle).includes('the-app-password-value'), false);
  assert.equal(JSON.stringify(scrubbedCycle).includes('Maximum call stack'), false);

  const evil: Record<string, unknown> = {};
  Object.defineProperty(evil, 'boom', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.equal(safeScrubSentryEvent(evil), null);

  const here = dirname(fileURLToPath(import.meta.url));
  const scrubSrc = readFileSync(join(here, '../lib/sentry-scrub.ts'), 'utf8');
  assert.match(scrubSrc, /beforeSendTransaction/);
  assert.match(scrubSrc, /beforeSend\(event: any\)/);
  assert.match(scrubSrc, /beforeBreadcrumb/);
  assert.match(scrubSrc, /beforeSendLog/);
  assert.match(scrubSrc, /catch/);
  for (const file of ['../sentry.server.config.ts', '../sentry.edge.config.ts', '../instrumentation-client.ts']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.match(src, /includeLocalVariables:\s*false/);
    assert.match(src, /sendDefaultPii:\s*false/);
    assert.match(src, /cookies:\s*false/);
    assert.match(src, /urlQueryParams:\s*false/);
    assert.match(src, /userInfo:\s*false/);
    assert.match(src, /sentryScrubHooks\(\)/);
    assert.doesNotMatch(src, /includeLocalVariables:\s*true/);
  }

  const sent: string[] = [];
  // @sentry/nextjs does not re-export capture APIs. The Node client is the server/edge
  // SDK those configs init, and it runs the same beforeSend / beforeSendTransaction /
  // beforeBreadcrumb hooks that sentry.edge.config.ts spreads in.
  const client = Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/1',
    tracesSampleRate: 1,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    integrations: [],
    transport() {
      return {
        send(envelope) {
          sent.push(JSON.stringify(envelope));
          return Promise.resolve({});
        },
        flush() {
          return Promise.resolve(true);
        },
      };
    },
    ...sentryScrubHooks(),
  });
  assert.equal(typeof client?.getOptions().beforeSendTransaction, 'function');
  assert.equal(typeof client?.getOptions().beforeBreadcrumb, 'function');
  assert.equal(typeof client?.getOptions().beforeSendLog, 'function');
  Sentry.addBreadcrumb({
    category: 'console',
    message: 'breadcrumb the-app-password-value',
    data: { 'http.query': 'code=oauth-code&state=oauth-state&email=adam%40tharrosmedia.com' },
  });
  const tx: Record<string, unknown> = {
    type: 'transaction',
    transaction: 'GET /middleware',
    timestamp: Date.now() / 1000,
    start_timestamp: Date.now() / 1000 - 1,
    contexts: { trace: { trace_id: 'c'.repeat(32), span_id: 'b'.repeat(16), op: 'http.server' } },
    message: 'refresh_token=1//refreshvalue the-app-password-value',
  };
  tx.self = tx;
  tx.sdkProcessingMetadata = { normalizedRequest: tx };
  Sentry.captureEvent(tx as unknown as Parameters<typeof Sentry.captureEvent>[0]);
  Sentry.captureException(new Error('exception the-app-password-value refresh_token=1//refreshvalue'));
  await Sentry.flush(2000);
  assert.ok(sent.length >= 1);
  const blob = sent.join('\n');
  assert.equal(blob.includes('Maximum call stack'), false);
  assert.equal(blob.includes('the-app-password-value'), false);
  assert.equal(blob.includes('oauth-code'), false);
  assert.equal(blob.includes('refreshvalue'), false);
  assert.match(blob, /"type":"transaction"/);
  assert.equal(blob.includes('c'.repeat(32)), true);

  await client?.close(2000);

  const fetched: string[] = [];
  const fetchClient = Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/1',
    tracesSampleRate: 1,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    integrations: [Sentry.nativeNodeFetchIntegration({ breadcrumbs: true, spans: true })],
    transport() {
      return {
        send(envelope) {
          fetched.push(JSON.stringify(envelope));
          return Promise.resolve({});
        },
        flush() {
          return Promise.resolve(true);
        },
      };
    },
    ...sentryScrubHooks(),
  });
  const http = await import('node:http');
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const tracked = [
    `http://127.0.0.1:${port}`,
    env.APP_PASSWORD,
    env.ADS_INTERNAL_KEY,
    env.ENCRYPTION_KEY,
    env.GSC_OAUTH_STATE_SECRET,
    'adam@tharrosmedia.com',
    'shpat_live999',
  ].join('/');
  await fetch(tracked);
  Sentry.captureException(new Error('fetch follow-up'));
  await Sentry.flush(2000);
  server.close();
  const fetchedBlob = fetched.join('\n');
  assert.ok(fetched.length >= 1);
  for (const secret of [
    'the-app-password-value',
    'ads-internal-test-key',
    'encryption-key-value',
    'gsc-state-secret-value',
    'adam@tharrosmedia.com',
    'shpat_live999',
  ]) {
    assert.equal(fetchedBlob.includes(secret), false, secret);
  }
  await fetchClient?.close(2000);
  console.log('sentry-scrub: ok');
} finally {
  if (prevKey === undefined) delete env.ADS_INTERNAL_KEY;
  else env.ADS_INTERNAL_KEY = prevKey;
  if (prevPassword === undefined) delete env.APP_PASSWORD;
  else env.APP_PASSWORD = prevPassword;
  if (prevEncryption === undefined) delete env.ENCRYPTION_KEY;
  else env.ENCRYPTION_KEY = prevEncryption;
  if (prevGsc === undefined) delete env.GSC_OAUTH_STATE_SECRET;
  else env.GSC_OAUTH_STATE_SECRET = prevGsc;
}
