import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JWT_LOCAL_FALLBACK,
  LOCAL_DEV_TOKEN_KEY,
  isProductionRuntime,
  signingSecretProblem,
} from '@cerevex/contracts';
import { adsApiConfigured } from '../lib/ads-bff';
import { productionSecretProblems } from '../lib/prod-secrets';
import { decryptSecret, encryptSecret } from '../../ads/shared/src/crypto';
import { loadEnv } from '../../ads/shared/src/env';
import { assertAdsProductionSecrets } from '../../ads/shared/src/production-secrets';

const env = process.env as Record<string, string | undefined>;
const keys = [
  'NODE_ENV',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'CEREVEX_REQUIRE_SIGNING_SECRETS',
  'JWT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'ADS_API_URL',
  'EXAMPLE_REQUIRED',
  'EXAMPLE_ADS',
] as const;
const prev = Object.fromEntries(keys.map((key) => [key, env[key]]));

function restore() {
  for (const key of keys) {
    const value = prev[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

function clearRuntime() {
  env.NODE_ENV = 'test';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
}

const here = dirname(fileURLToPath(import.meta.url));

try {
  assert.equal(isProductionRuntime({}), false);
  assert.equal(isProductionRuntime({ NODE_ENV: 'staging' }), false);
  assert.equal(isProductionRuntime({ NODE_ENV: ' Production ' }), true);
  assert.equal(isProductionRuntime({ RAILWAY_ENVIRONMENT_NAME: '   ' }), false);
  assert.equal(isProductionRuntime({ RAILWAY_ENVIRONMENT_NAME: 'staging' }), true);
  assert.equal(isProductionRuntime({ RAILWAY_ENVIRONMENT: 'production-eu' }), true);
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: 'true' }), true);
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: 'TRUE' }), true);
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: '1' }), true);
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: 'yes' }), false);

  assert.equal(signingSecretProblem(undefined, [JWT_LOCAL_FALLBACK]), 'missing');
  assert.equal(signingSecretProblem('   ', [JWT_LOCAL_FALLBACK]), 'missing');
  assert.equal(signingSecretProblem(JWT_LOCAL_FALLBACK.toUpperCase(), [JWT_LOCAL_FALLBACK]), 'placeholder');
  assert.equal(signingSecretProblem(`  ${LOCAL_DEV_TOKEN_KEY.toUpperCase()}  `, [LOCAL_DEV_TOKEN_KEY]), 'placeholder');
  assert.equal(signingSecretProblem('a'.repeat(31), [JWT_LOCAL_FALLBACK]), 'short');
  assert.equal(signingSecretProblem('a'.repeat(32), [JWT_LOCAL_FALLBACK]), null);

  clearRuntime();
  delete env.EXAMPLE_REQUIRED;
  env.NODE_ENV = 'production';
  assert.deepEqual(
    productionSecretProblems([
      { env: 'EXAMPLE_REQUIRED', kind: 'secret', requiredInProduction: 'brain', help: '' },
    ]),
    ['EXAMPLE_REQUIRED:missing'],
  );
  env.EXAMPLE_REQUIRED = 'present';
  assert.deepEqual(
    productionSecretProblems([
      { env: 'EXAMPLE_REQUIRED', kind: 'secret', requiredInProduction: 'brain', help: '' },
    ]),
    [],
  );
  clearRuntime();
  assert.deepEqual(
    productionSecretProblems([
      { env: 'EXAMPLE_REQUIRED', kind: 'secret', requiredInProduction: 'brain', help: '' },
    ]),
    [],
  );

  clearRuntime();
  delete env.ADS_API_URL;
  assert.equal(adsApiConfigured(), true);
  env.RAILWAY_ENVIRONMENT_NAME = 'staging';
  assert.equal(adsApiConfigured(), false);
  env.ADS_API_URL = 'http://127.0.0.1:9';
  assert.equal(adsApiConfigured(), true);
  delete env.ADS_API_URL;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.CEREVEX_REQUIRE_SIGNING_SECRETS = '1';
  assert.equal(adsApiConfigured(), false);

  loadEnv();
  clearRuntime();
  env.RAILWAY_ENVIRONMENT_NAME = 'production-eu';
  env.JWT_SECRET = 'c'.repeat(32);
  delete env.TOKEN_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret('token'), /TOKEN_ENCRYPTION_KEY is missing in production/);
  assert.throws(() => assertAdsProductionSecrets(), /TOKEN_ENCRYPTION_KEY:missing/);
  env.TOKEN_ENCRYPTION_KEY = 'abc';
  assert.throws(() => encryptSecret('token'), /TOKEN_ENCRYPTION_KEY is short in production/);
  assert.throws(() => assertAdsProductionSecrets(), /TOKEN_ENCRYPTION_KEY:short/);
  env.TOKEN_ENCRYPTION_KEY = LOCAL_DEV_TOKEN_KEY.toUpperCase();
  assert.throws(() => encryptSecret('token'), /TOKEN_ENCRYPTION_KEY is placeholder in production/);
  assert.throws(() => assertAdsProductionSecrets(), /TOKEN_ENCRYPTION_KEY:placeholder/);
  env.TOKEN_ENCRYPTION_KEY = 'd'.repeat(32);
  assert.doesNotThrow(() => assertAdsProductionSecrets());
  const packed = encryptSecret('plaintext-marker-9f3c');
  assert.equal(decryptSecret(packed), 'plaintext-marker-9f3c');
  assert.equal(packed.includes('plaintext-marker-9f3c'), false);

  clearRuntime();
  delete env.TOKEN_ENCRYPTION_KEY;
  const local = encryptSecret('local-token');
  assert.equal(decryptSecret(local), 'local-token');
  env.NODE_ENV = 'production';
  assert.throws(() => assertAdsProductionSecrets([{ env: 'EXAMPLE_ADS', kind: 'secret', requiredInProduction: 'ads', help: '' }]), /EXAMPLE_ADS:missing/);
  env.EXAMPLE_ADS = 'set';
  assert.doesNotThrow(() =>
    assertAdsProductionSecrets([{ env: 'EXAMPLE_ADS', kind: 'secret', requiredInProduction: 'ads', help: '' }]),
  );
  delete env.EXAMPLE_ADS;

  const files = [
    join(here, '../../ads/shared/src/crypto.ts'),
    join(here, '../../ads/api/src/app.ts'),
    join(here, '../lib/auth-cookie.ts'),
    join(here, '../lib/ads-bff.ts'),
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /NODE_ENV\s*===\s*['"]production['"]/, file);
    assert.match(source, /isProductionRuntime/, file);
  }
  const worker = readFileSync(join(here, '../../ads/workers/src/index.ts'), 'utf8');
  assert.match(worker, /assertAdsProductionSecrets/);
  assert.match(worker, /process\.exit\(1\)/);
  const secrets = readFileSync(join(here, '../lib/prod-secrets.ts'), 'utf8');
  assert.match(secrets, /opsEnvRequiredInProduction\('brain'\)/);

  console.log('signing-runtime: ok');
} finally {
  restore();
}
