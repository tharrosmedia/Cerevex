import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GscOAuthStateError,
  gscOAuthBind,
  resetGscOAuthStateForTests,
  signGscOAuthState,
  verifyGscOAuthState,
} from '../src/lib/gsc/oauth-state';

const secret = 'test-gsc-state-secret';
const storeId = 'store-1';
const sid = 'random-sid-not-a-password';
const password = 'console-session-password';
const bind = gscOAuthBind(sid, secret);
const now = 1_700_000_000_000;

function sign(overrides?: { storeId?: string; bind?: string; ttlMs?: number; now?: number }) {
  return signGscOAuthState(
    { storeId: overrides?.storeId ?? storeId, bind: overrides?.bind ?? bind },
    { secret, now: overrides?.now ?? now, ttlMs: overrides?.ttlMs },
  );
}

function payloadJson(token: string): string {
  return Buffer.from(token.slice(0, token.indexOf('.')), 'base64url').toString('utf8');
}

resetGscOAuthStateForTests();
{
  const token = sign();
  const verified = verifyGscOAuthState(token, { secret, now: now + 1000, storeId, bind });
  assert.equal(verified.storeId, storeId);
  assert.equal(verified.bind, bind);
  const json = payloadJson(token);
  const passwordHash = createHmac('sha256', 'gsc-oauth-subject').update(password).digest('base64url');
  assert.equal(json.includes(password), false);
  assert.equal(json.includes(passwordHash), false);
  assert.equal(json.includes(sid), false);
}

resetGscOAuthStateForTests();
{
  const token = sign();
  const flipped = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.throws(() => verifyGscOAuthState(flipped, { secret, now }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'tampered';
  });
}

resetGscOAuthStateForTests();
{
  const token = sign({ ttlMs: 1000 });
  assert.throws(() => verifyGscOAuthState(token, { secret, now: now + 1001, storeId, bind }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'expired';
  });
}

resetGscOAuthStateForTests();
{
  const token = sign();
  verifyGscOAuthState(token, { secret, now, storeId, bind });
  assert.throws(() => verifyGscOAuthState(token, { secret, now, storeId, bind }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'replayed';
  });
}

resetGscOAuthStateForTests();
{
  const token = sign();
  assert.throws(() => verifyGscOAuthState(token, { secret, now, storeId: 'store-2', bind }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'store_mismatch';
  });
  const stillGood = verifyGscOAuthState(token, { secret, now, storeId, bind });
  assert.equal(stillGood.storeId, storeId);
}

resetGscOAuthStateForTests();
{
  const token = sign();
  assert.throws(() => verifyGscOAuthState(token, { secret, now, bind: gscOAuthBind('other-sid', secret) }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'bind_mismatch';
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const callback = readFileSync(join(here, '../app/api/gsc/oauth/callback/route.ts'), 'utf8');
const start = readFileSync(join(here, '../app/api/gsc/oauth/start/route.ts'), 'utf8');
assert.match(callback, /publicRedirect\(/);
assert.match(callback, /GSC_OAUTH_SID_COOKIE/);
assert.match(start, /httpOnly: true/);
assert.doesNotMatch(callback, /oauthSubjectFromCookie/);
assert.doesNotMatch(start, /oauthSubjectFromCookie/);
assert.doesNotMatch(start, /APP_PASSWORD/);

console.log('gsc-oauth-state: ok');
