import assert from 'node:assert/strict';
import {
  AUTH_COOKIE_NAME,
  AUTH_IDLE_MAX_AGE,
  authCookieOptions,
  clearAuthCookie,
  setAuthCookie,
} from '../lib/auth-cookie';

assert.equal(AUTH_COOKIE_NAME, 'auth');
assert.equal(AUTH_IDLE_MAX_AGE, 60 * 60 * 24 * 3);

const env = process.env as Record<string, string | undefined>;
const prev = {
  NODE_ENV: env.NODE_ENV,
  RAILWAY_ENVIRONMENT: env.RAILWAY_ENVIRONMENT,
  RAILWAY_ENVIRONMENT_NAME: env.RAILWAY_ENVIRONMENT_NAME,
  CEREVEX_REQUIRE_SIGNING_SECRETS: env.CEREVEX_REQUIRE_SIGNING_SECRETS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

try {
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
  env.NODE_ENV = 'production';
  const prod = authCookieOptions();
  assert.equal(prod.httpOnly, true);
  assert.equal(prod.secure, true);
  assert.equal(prod.sameSite, 'lax');
  assert.equal(prod.path, '/');
  assert.equal(prod.maxAge, AUTH_IDLE_MAX_AGE);

  env.NODE_ENV = 'development';
  const dev = authCookieOptions();
  assert.equal(dev.secure, false);
  env.RAILWAY_ENVIRONMENT_NAME = 'production-eu';
  assert.equal(authCookieOptions().secure, true);
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.CEREVEX_REQUIRE_SIGNING_SECRETS = '1';
  assert.equal(authCookieOptions().secure, true);
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
  assert.equal(authCookieOptions().secure, false);
  assert.equal(dev.maxAge, AUTH_IDLE_MAX_AGE);
  assert.equal(dev.httpOnly, true);
  assert.equal(dev.sameSite, 'lax');
  assert.equal(dev.path, '/');

  const writes: Array<{ name: string; value: string; options: ReturnType<typeof authCookieOptions> }> = [];
  setAuthCookie(
    {
      set(name, value, options) {
        writes.push({ name, value, options: options! });
      },
    },
    'shared-console-password',
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'auth');
  assert.equal(writes[0].value, 'shared-console-password');
  assert.deepEqual(writes[0].options, authCookieOptions());

  const cleared: Array<{ name: string; path: string }> = [];
  clearAuthCookie({
    delete(cookie) {
      cleared.push(cookie);
    },
  });
  assert.deepEqual(cleared, [{ name: 'auth', path: '/' }]);

  console.log('auth-cookie: ok');
} finally {
  restoreEnv();
}
