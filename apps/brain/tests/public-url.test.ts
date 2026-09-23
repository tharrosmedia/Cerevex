import assert from 'node:assert/strict';
import { publicOrigin, publicRedirect } from '../lib/public-url';

const prevPublicUrl = process.env.PUBLIC_URL;

function restorePublicUrl() {
  if (prevPublicUrl === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = prevPublicUrl;
}

function railwayCallbackReq() {
  return {
    url: 'https://localhost:8080/api/gsc/oauth/callback?code=fake&state=test',
    headers: {
      get(name: string) {
        const headers: Record<string, string> = {
          host: 'localhost:8080',
          'x-forwarded-host': 'cerevex.store',
          'x-forwarded-proto': 'https',
        };
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

try {
  process.env.PUBLIC_URL = 'https://cerevex.store';
  const req = railwayCallbackReq();
  const connected = publicRedirect('/settings?gsc=connected', req);
  assert.equal(connected.host, 'cerevex.store');
  assert.notEqual(connected.hostname, 'localhost');
  assert.equal(connected.origin, 'https://cerevex.store');
  assert.equal(connected.pathname, '/settings');
  assert.equal(connected.searchParams.get('gsc'), 'connected');

  const failed = publicRedirect('/settings?gsc=error&message=oauth%20failed', {
    url: 'https://localhost:8080/api/gsc/oauth/callback?code=fake&state=test',
  });
  assert.equal(failed.host, 'cerevex.store');
  assert.equal(failed.searchParams.get('gsc'), 'error');

  const adsBack = publicRedirect('/ads', { url: 'https://localhost:8080/api/ads/connect?platform=google' });
  assert.equal(adsBack.host, 'cerevex.store');
  assert.equal(adsBack.pathname, '/ads');

  delete process.env.PUBLIC_URL;
  assert.equal(publicOrigin(railwayCallbackReq()), 'https://cerevex.store');
  const viaHeaders = publicRedirect('/settings?gsc=connected', railwayCallbackReq());
  assert.equal(viaHeaders.host, 'cerevex.store');

  const loopbackOnly = {
    url: 'https://localhost:8080/api/gsc/oauth/callback?code=fake&state=test',
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'host' ? 'localhost:8080' : null;
      },
    },
  };
  assert.equal(publicOrigin(loopbackOnly), 'https://localhost:8080');

  console.log('public-url: ok');
} finally {
  restorePublicUrl();
}
