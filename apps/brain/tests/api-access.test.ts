import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADS_PUBLIC_ROUTE_INVENTORY, API_ROUTE_INVENTORY, guardApi } from '../lib/api-access';
import { middleware } from '../middleware';
import { passwordMatches, secretsMatch } from '../lib/sensitive-auth';

const env = process.env as Record<string, string | undefined>;
const prevPassword = env.APP_PASSWORD;
const prevApprovers = env.APPROVE_OPERATOR_EMAILS;
const prevConsole = env.CONSOLE_OPERATOR_EMAIL;
const prevKey = env.ADS_INTERNAL_KEY;
const prevNode = env.NODE_ENV;
const prevRailway = env.RAILWAY_ENVIRONMENT;
const prevRailwayName = env.RAILWAY_ENVIRONMENT_NAME;

function restore() {
  if (prevPassword === undefined) delete env.APP_PASSWORD;
  else env.APP_PASSWORD = prevPassword;
  if (prevApprovers === undefined) delete env.APPROVE_OPERATOR_EMAILS;
  else env.APPROVE_OPERATOR_EMAILS = prevApprovers;
  if (prevConsole === undefined) delete env.CONSOLE_OPERATOR_EMAIL;
  else env.CONSOLE_OPERATOR_EMAIL = prevConsole;
  if (prevKey === undefined) delete env.ADS_INTERNAL_KEY;
  else env.ADS_INTERNAL_KEY = prevKey;
  if (prevNode === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = prevNode;
  if (prevRailway === undefined) delete env.RAILWAY_ENVIRONMENT;
  else env.RAILWAY_ENVIRONMENT = prevRailway;
  if (prevRailwayName === undefined) delete env.RAILWAY_ENVIRONMENT_NAME;
  else env.RAILWAY_ENVIRONMENT_NAME = prevRailwayName;
}

try {
  env.NODE_ENV = 'production';
  env.APP_PASSWORD = 'console-secret';
  env.ADS_INTERNAL_KEY = 'internal-secret';
  delete env.APPROVE_OPERATOR_EMAILS;
  delete env.CONSOLE_OPERATOR_EMAIL;

  const p0 = API_ROUTE_INVENTORY.filter((entry) => entry.p0 === 'B1');
  assert.deepEqual(
    p0.map((entry) => entry.path),
    ['/api/approve', '/api/ads/decide', '/recommendations/:id/decide', '/recommendations/:id/apply'],
  );
  assert.equal(API_ROUTE_INVENTORY[0]?.p0, 'B1');

  const publicRoutes: Array<[string, string]> = [
    ['/api/login', 'POST'],
    ['/api/inngest', 'GET'],
    ['/api/inngest', 'POST'],
    ['/api/inngest', 'PUT'],
    ['/api/gsc/oauth/callback', 'GET'],
    ['/api/ads/pixel', 'GET'],
    ['/api/ads/collect', 'POST'],
    ['/api/ads/collect', 'OPTIONS'],
    ['/api/health', 'GET'],
  ];
  for (const [path, method] of publicRoutes) {
    assert.equal(guardApi(path, method, { cookie: null, internalKey: null }).kind, 'public', path);
  }

  const gated = guardApi('/api/wordpress/plugin', 'GET', { cookie: null, internalKey: null });
  assert.equal(gated.kind, 'deny');
  if (gated.kind === 'deny') assert.equal(gated.status, 401);

  const unknown = guardApi('/api/not-a-route', 'POST', { cookie: null, internalKey: null });
  assert.equal(unknown.kind, 'deny');

  const session = guardApi('/api/wordpress/plugin', 'GET', { cookie: 'console-secret', internalKey: null });
  assert.equal(session.kind, 'allow');

  const queryKey = guardApi('/api/approve', 'POST', { cookie: null, internalKey: null });
  assert.equal(queryKey.kind, 'deny');

  const wrongKey = guardApi('/api/approve', 'POST', { cookie: null, internalKey: 'nope' });
  assert.equal(wrongKey.kind, 'deny');
  if (wrongKey.kind === 'deny') assert.equal(wrongKey.status, 401);

  const internal = guardApi('/api/approve', 'POST', { cookie: null, internalKey: 'internal-secret' });
  assert.equal(internal.kind, 'allow');

  const approver = guardApi('/api/approve', 'POST', { cookie: 'console-secret', internalKey: null });
  assert.equal(approver.kind, 'allow');

  env.APPROVE_OPERATOR_EMAILS = 'nobody@example.com';
  const notApprover = guardApi('/api/ads/decide', 'POST', { cookie: 'console-secret', internalKey: null });
  assert.equal(notApprover.kind, 'deny');
  if (notApprover.kind === 'deny') assert.equal(notApprover.status, 403);

  async function call(path: string, method: string, headers?: Record<string, string>) {
    const response = await middleware(new NextRequest(`http://localhost${path}`, { method, headers }));
    return response;
  }

  delete env.APPROVE_OPERATOR_EMAILS;
  assert.equal((await call('/api/wordpress/plugin', 'GET')).status, 401);
  assert.equal((await call('/api/approve', 'POST')).status, 401);
  assert.notEqual((await call('/api/inngest', 'POST')).status, 401);
  assert.notEqual((await call('/api/login', 'POST')).status, 401);
  assert.notEqual((await call('/api/gsc/oauth/callback', 'GET')).status, 401);
  assert.notEqual((await call('/api/ads/pixel', 'GET')).status, 401);
  assert.equal((await call('/api/meta/data-deletion', 'POST')).status, 401);
  assert.equal((await call('/api/webhooks/shopify', 'POST')).status, 401);
  assert.equal(
    (await call('/api/approve', 'POST', { 'x-cerevex-internal-key': 'nope' })).status,
    401,
  );
  assert.notEqual(
    (await call('/api/approve', 'POST', { cookie: 'auth=console-secret' })).status,
    401,
  );
  const query = await call('/api/approve?x-cerevex-internal-key=internal-secret', 'POST');
  assert.equal(query.status, 401);
  assert.equal(secretsMatch('console-secret', 'console-secret'), true);
  assert.equal(secretsMatch('console-secre', 'console-secret'), false);
  assert.equal(secretsMatch('Console-secret', 'console-secret'), false);
  assert.equal(passwordMatches('console-secret'), true);
  assert.equal(passwordMatches('nope'), false);

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, '../../..');
  const appDir = join(here, '../app');
  for (const entry of API_ROUTE_INVENTORY) {
    if (entry.surface !== 'brain' || entry.auth !== 'public') continue;
    const routeFile = join(appDir, entry.path.replace(/^\//, ''), 'route.ts');
    assert.equal(existsSync(routeFile), true, entry.path);
  }
  for (const entry of ADS_PUBLIC_ROUTE_INVENTORY) {
    assert.ok(entry.source && entry.marker);
    const src = readFileSync(join(repoRoot, entry.source), 'utf8');
    assert.ok(src.includes(entry.marker), `${entry.surface} ${entry.path}`);
  }
  const sessionNotes = API_ROUTE_INVENTORY.filter((entry) => entry.path.startsWith('/api/ads/') && entry.auth === 'session');
  for (const entry of sessionNotes) {
    assert.match(entry.intendedAuth, /consoleAuthorized/);
  }

  delete env.APP_PASSWORD;
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.NODE_ENV = 'production';
  assert.equal((await call('/settings', 'GET')).status, 503);
  assert.notEqual((await call('/login', 'GET')).status, 503);
  assert.notEqual((await call('/privacy-policy', 'GET')).status, 503);
  env.NODE_ENV = 'test';
  assert.notEqual((await call('/settings', 'GET')).status, 503);

  console.log('api-access: ok');
} finally {
  restore();
}
