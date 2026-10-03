import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADS_COLLECT_MAX_BODY_BYTES,
  adsCollectCorsHeaders,
  inspectAdsCollectRequest,
  resetAdsCollectLimits,
} from '../lib/ads-collect';

const env = process.env as Record<string, string | undefined>;
const prev = env.ADS_COLLECT_ORIGINS;

function post(body: string, headers?: Record<string, string>) {
  return new Request('http://localhost/api/ads/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

try {
  env.ADS_COLLECT_ORIGINS = 'https://shop.example, https://other.example';
  resetAdsCollectLimits();

  const ok = await inspectAdsCollectRequest(post('{"event":"view"}', { origin: 'https://shop.example' }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal((ok.body as { event: string }).event, 'view');
  assert.equal(adsCollectCorsHeaders('https://shop.example')['Access-Control-Allow-Origin'], 'https://shop.example');
  assert.equal(adsCollectCorsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
  assert.equal(JSON.stringify(adsCollectCorsHeaders('https://shop.example')).includes('*'), false);

  const forbidden = await inspectAdsCollectRequest(post('{"event":"view"}', { origin: 'https://evil.example' }));
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.status, 403);

  const huge = await inspectAdsCollectRequest(post('{"event":"x"}', {
    'content-length': String(ADS_COLLECT_MAX_BODY_BYTES + 1),
    origin: 'https://shop.example',
  }));
  assert.equal(huge.ok, false);
  if (!huge.ok) {
    assert.equal(huge.status, 413);
    assert.equal(huge.error, 'payload too large');
  }

  resetAdsCollectLimits();
  for (let i = 0; i < 30; i += 1) {
    const allowed = await inspectAdsCollectRequest(post('{"n":1}', { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    assert.equal(allowed.ok, true, String(i));
  }
  const limited = await inspectAdsCollectRequest(post('{"n":1}', { 'x-forwarded-for': '203.0.113.9' }));
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.status, 429);

  const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/ads/collect/route.ts'), 'utf8');
  assert.doesNotMatch(route, /Access-Control-Allow-Origin': '\*'/);
  assert.doesNotMatch(route, /result\.message/);
  assert.match(route, /collect failed/);

  console.log('ads-collect: ok');
} finally {
  resetAdsCollectLimits();
  if (prev === undefined) delete env.ADS_COLLECT_ORIGINS;
  else env.ADS_COLLECT_ORIGINS = prev;
}
