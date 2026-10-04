import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { createApp } from '../../ads/api/src/app';
import {
  JWT_LOCAL_FALLBACK,
  assertJwtSecretConfigured,
  configuredJwtSecret,
  jwtSecretBytes,
  warnIfJwtSecretUnset,
} from '../../ads/api/src/jwt-secret';

const env = process.env as Record<string, string | undefined>;
const prev = {
  JWT_SECRET: env.JWT_SECRET,
  TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
  NODE_ENV: env.NODE_ENV,
  RAILWAY_ENVIRONMENT: env.RAILWAY_ENVIRONMENT,
  RAILWAY_ENVIRONMENT_NAME: env.RAILWAY_ENVIRONMENT_NAME,
  CEREVEX_REQUIRE_SIGNING_SECRETS: env.CEREVEX_REQUIRE_SIGNING_SECRETS,
};

function restore() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

function applySecret(kind: 'unset' | 'empty' | 'whitespace') {
  if (kind === 'unset') delete env.JWT_SECRET;
  else if (kind === 'empty') env.JWT_SECRET = '';
  else env.JWT_SECRET = '   ';
}

/** Three production signals alone, plus all three together, each with unset, empty, and whitespace. */
const setups: Array<{
  node: string;
  railway?: string;
  name?: string;
  secret: 'unset' | 'empty' | 'whitespace';
}> = [
  { node: 'production', secret: 'unset' },
  { node: 'production', secret: 'empty' },
  { node: 'production', secret: 'whitespace' },
  { node: 'test', railway: 'production', secret: 'unset' },
  { node: 'test', railway: 'production', secret: 'empty' },
  { node: 'test', railway: 'production', secret: 'whitespace' },
  { node: 'test', name: 'production', secret: 'unset' },
  { node: 'test', name: 'production', secret: 'empty' },
  { node: 'test', name: 'production', secret: 'whitespace' },
  { node: 'production', railway: 'production', name: 'production', secret: 'unset' },
  { node: 'production', railway: 'production', name: 'production', secret: 'empty' },
  { node: 'production', railway: 'production', name: 'production', secret: 'whitespace' },
];

async function fallbackToken(): Promise<string> {
  return new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_LOCAL_FALLBACK));
}

async function whitespaceToken(): Promise<string> {
  return new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('   '));
}

try {
  env.NODE_ENV = 'test';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
  delete env.JWT_SECRET;
  env.TOKEN_ENCRYPTION_KEY = 'b'.repeat(32);
  const lines: string[] = [];
  assert.doesNotThrow(() => warnIfJwtSecretUnset((message) => lines.push(message)));
  assert.match(lines[0] || '', /JWT_SECRET is unset/);
  assert.match(lines[0] || '', /keep running/);
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), JWT_LOCAL_FALLBACK);

  env.JWT_SECRET = '';
  const emptyLines: string[] = [];
  warnIfJwtSecretUnset((message) => emptyLines.push(message));
  assert.match(emptyLines[0] || '', /JWT_SECRET is unset/);
  assert.equal(configuredJwtSecret(), null);

  env.JWT_SECRET = '   ';
  const blankLines: string[] = [];
  warnIfJwtSecretUnset((message) => blankLines.push(message));
  assert.match(blankLines[0] || '', /JWT_SECRET is unset/);
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), JWT_LOCAL_FALLBACK);

  env.JWT_SECRET = '  ci-jwt-secret-not-for-prod  ';
  const quiet: string[] = [];
  warnIfJwtSecretUnset((message) => quiet.push(message));
  assert.equal(quiet.length, 0);
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), 'ci-jwt-secret-not-for-prod');

  const forged = await fallbackToken();
  const whitespaceForged = await whitespaceToken();
  const app = createApp();
  assert.equal(setups.length, 12);
  for (const setup of setups) {
    env.NODE_ENV = setup.node;
    if (setup.railway) env.RAILWAY_ENVIRONMENT = setup.railway;
    else delete env.RAILWAY_ENVIRONMENT;
    if (setup.name) env.RAILWAY_ENVIRONMENT_NAME = setup.name;
    else delete env.RAILWAY_ENVIRONMENT_NAME;
    delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
    applySecret(setup.secret);
    assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);
    assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);
    const response = await app.request('/auth/me', { headers: { authorization: `Bearer ${forged}` } });
    assert.equal(response.status, 401, `${setup.node} ${setup.railway ?? ''} ${setup.name ?? ''} ${setup.secret}`);
    if (setup.secret === 'whitespace') {
      const blank = await app.request('/auth/me', { headers: { authorization: `Bearer ${whitespaceForged}` } });
      assert.equal(blank.status, 401);
    }
  }

  for (const node of ['Production', ' production ', 'PRODUCTION']) {
    env.NODE_ENV = node;
    delete env.RAILWAY_ENVIRONMENT;
    delete env.RAILWAY_ENVIRONMENT_NAME;
    delete env.JWT_SECRET;
    assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);
    const response = await app.request('/auth/me', { headers: { authorization: `Bearer ${forged}` } });
    assert.equal(response.status, 401, node);
  }
  env.NODE_ENV = 'test';
  env.RAILWAY_ENVIRONMENT = ' production ';
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.JWT_SECRET;
  assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);
  delete env.RAILWAY_ENVIRONMENT;
  env.RAILWAY_ENVIRONMENT_NAME = 'Production';
  assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);

  env.NODE_ENV = 'production';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.JWT_SECRET = JWT_LOCAL_FALLBACK;
  assert.equal(configuredJwtSecret(), null);
  assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);
  assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);
  const placeholder = await app.request('/auth/me', { headers: { authorization: `Bearer ${forged}` } });
  assert.equal(placeholder.status, 401);
  env.JWT_SECRET = `  ${JWT_LOCAL_FALLBACK}  `;
  assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);

  env.NODE_ENV = 'test';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.JWT_SECRET = JWT_LOCAL_FALLBACK;
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), JWT_LOCAL_FALLBACK);
  assert.doesNotThrow(() => assertJwtSecretConfigured());

  env.NODE_ENV = 'production';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
  env.JWT_SECRET = JWT_LOCAL_FALLBACK.toUpperCase();
  assert.equal(configuredJwtSecret(), null);
  assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET:placeholder/);
  assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);
  const upper = await app.request('/auth/me', { headers: { authorization: `Bearer ${forged}` } });
  assert.equal(upper.status, 401);
  env.JWT_SECRET = `  ${JWT_LOCAL_FALLBACK.toLowerCase()}  `;
  assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET:placeholder/);

  env.JWT_SECRET = 'a'.repeat(31);
  assert.equal(configuredJwtSecret(), null);
  assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET:short/);
  assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);
  env.JWT_SECRET = 'a'.repeat(32);
  assert.equal(configuredJwtSecret(), 'a'.repeat(32));
  assert.doesNotThrow(() => assertJwtSecretConfigured());
  const real = await app.request('/auth/me', { headers: { authorization: `Bearer ${forged}` } });
  assert.equal(real.status, 401);

  env.NODE_ENV = 'test';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
  delete env.JWT_SECRET;
  for (const name of ['staging', 'production-eu']) {
    env.RAILWAY_ENVIRONMENT_NAME = name;
    assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET:missing/, name);
    assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);
    const named = await app.request('/auth/me', { headers: { authorization: `Bearer ${forged}` } });
    assert.equal(named.status, 401, name);
  }
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.RAILWAY_ENVIRONMENT = 'staging';
  assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);
  delete env.RAILWAY_ENVIRONMENT;
  env.CEREVEX_REQUIRE_SIGNING_SECRETS = 'true';
  assert.throws(() => assertJwtSecretConfigured(), /Refusing to boot/);
  env.CEREVEX_REQUIRE_SIGNING_SECRETS = 'TRUE';
  assert.throws(() => jwtSecretBytes(), /Refusing to sign or verify/);
  env.CEREVEX_REQUIRE_SIGNING_SECRETS = '1';
  env.JWT_SECRET = 'a'.repeat(31);
  assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET:short/);

  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.NODE_ENV = 'staging';
  delete env.JWT_SECRET;
  assert.doesNotThrow(() => assertJwtSecretConfigured());
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), JWT_LOCAL_FALLBACK);
  env.JWT_SECRET = 'a'.repeat(31);
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), 'a'.repeat(31));
  env.JWT_SECRET = JWT_LOCAL_FALLBACK.toUpperCase();
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), JWT_LOCAL_FALLBACK.toUpperCase());

  const boot = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../ads/api/src/index.ts'), 'utf8');
  assert.match(boot, /assertJwtSecretConfigured/);
  assert.match(boot, /process\.exit\(1\)/);

  console.log('jwt-secret-warning: ok');
} finally {
  restore();
}
