import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_PASSWORD_PLACEHOLDER,
  JWT_LOCAL_FALLBACK,
  LOCAL_DEV_TOKEN_KEY,
  isProductionRuntime,
  signingSecretProblem,
} from '@cerevex/contracts';
import { adsApiConfigured } from '../lib/ads-bff';
import { productionSecretProblems } from '../lib/prod-secrets';
import { decryptSecret, encryptSecret } from '../../ads/shared/src/crypto';
import { loadEnv } from '../../ads/shared/src/env';
import {
  assertAdsApiProductionSecrets,
  assertAdsWorkerProductionSecrets,
} from '../../ads/shared/src/production-secrets';

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
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: 'yes' }), true);
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: ' YES ' }), true);
  assert.equal(isProductionRuntime({ CEREVEX_REQUIRE_SIGNING_SECRETS: 'on' }), false);
  assert.equal(signingSecretProblem('😀'.repeat(16), [JWT_LOCAL_FALLBACK]), 'short');
  assert.equal(signingSecretProblem('😀'.repeat(32), [JWT_LOCAL_FALLBACK]), null);

  const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  Reflect.deleteProperty(globalThis, 'process');
  try {
    assert.equal(isProductionRuntime(), true);
  } finally {
    if (processDescriptor) Object.defineProperty(globalThis, 'process', processDescriptor);
  }

  assert.equal(signingSecretProblem(undefined, [JWT_LOCAL_FALLBACK]), 'missing');
  assert.equal(signingSecretProblem('   ', [JWT_LOCAL_FALLBACK]), 'missing');
  assert.equal(signingSecretProblem(JWT_LOCAL_FALLBACK.toUpperCase(), [JWT_LOCAL_FALLBACK]), 'placeholder');
  assert.equal(signingSecretProblem(`  ${LOCAL_DEV_TOKEN_KEY.toUpperCase()}  `, [LOCAL_DEV_TOKEN_KEY]), 'placeholder');
  assert.equal(signingSecretProblem(APP_PASSWORD_PLACEHOLDER.toUpperCase(), [APP_PASSWORD_PLACEHOLDER], 1), 'placeholder');
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
  assert.throws(() => assertAdsApiProductionSecrets(), /TOKEN_ENCRYPTION_KEY:missing/);
  assert.throws(() => assertAdsWorkerProductionSecrets(), /TOKEN_ENCRYPTION_KEY:missing/);
  env.TOKEN_ENCRYPTION_KEY = 'abc';
  assert.throws(() => encryptSecret('token'), /TOKEN_ENCRYPTION_KEY is short in production/);
  assert.throws(() => assertAdsApiProductionSecrets(), /TOKEN_ENCRYPTION_KEY:short/);
  env.TOKEN_ENCRYPTION_KEY = LOCAL_DEV_TOKEN_KEY.toUpperCase();
  assert.throws(() => encryptSecret('token'), /TOKEN_ENCRYPTION_KEY is placeholder in production/);
  assert.throws(() => assertAdsWorkerProductionSecrets(), /TOKEN_ENCRYPTION_KEY:placeholder/);
  env.TOKEN_ENCRYPTION_KEY = 'd'.repeat(32);
  assert.doesNotThrow(() => assertAdsApiProductionSecrets());
  assert.doesNotThrow(() => assertAdsWorkerProductionSecrets());
  const packed = encryptSecret('plaintext-marker-9f3c');
  assert.equal(decryptSecret(packed), 'plaintext-marker-9f3c');
  assert.equal(packed.includes('plaintext-marker-9f3c'), false);

  clearRuntime();
  delete env.TOKEN_ENCRYPTION_KEY;
  const local = encryptSecret('local-token');
  assert.equal(decryptSecret(local), 'local-token');
  env.NODE_ENV = 'production';
  assert.throws(
    () => assertAdsApiProductionSecrets([{ env: 'EXAMPLE_ADS', kind: 'secret', requiredInProduction: 'ads-api', help: '' }]),
    /EXAMPLE_ADS:missing/,
  );
  env.EXAMPLE_ADS = 'set';
  assert.doesNotThrow(() =>
    assertAdsApiProductionSecrets([{ env: 'EXAMPLE_ADS', kind: 'secret', requiredInProduction: 'ads-api', help: '' }]),
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
  assert.match(worker, /assertAdsWorkerProductionSecrets/);
  assert.doesNotMatch(worker, /assertAdsApiProductionSecrets/);
  assert.match(worker, /process\.exit\(1\)/);
  const apiBoot = readFileSync(join(here, '../../ads/api/src/index.ts'), 'utf8');
  assert.match(apiBoot, /assertJwtSecretConfigured/);
  assert.match(apiBoot, /process\.exit\(1\)/);
  for (const file of [
    join(here, '../app/layout.tsx'),
    join(here, '../app/page.tsx'),
    join(here, '../app/history/page.tsx'),
    join(here, '../app/stores/page.tsx'),
    join(here, '../app/seo/create/page.tsx'),
    join(here, '../src/lib/wordpress/connect.ts'),
    join(here, '../src/lib/db/workspace-modules.ts'),
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /NODE_ENV\s*===\s*['"]production['"]/, file);
  }

  function encryptLegacy(plaintext: string, raw: string): string {
    const key = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : raw.length === 32
        ? Buffer.from(raw, 'utf8')
        : scryptSync(raw, 'tharros-os-token', 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
  }
  clearRuntime();
  for (const raw of ['e'.repeat(32) + '\n', ' ' + 'f'.repeat(40), 'ab'.repeat(32) + ' ', 'g'.repeat(32) + ' ']) {
    env.TOKEN_ENCRYPTION_KEY = raw;
    assert.equal(decryptSecret(encryptLegacy('stored-oauth-token', raw)), 'stored-oauth-token');
  }
  env.NODE_ENV = 'production';
  env.JWT_SECRET = 'h'.repeat(40);
  env.TOKEN_ENCRYPTION_KEY = ' ' + 'i'.repeat(40);
  assert.throws(() => assertAdsApiProductionSecrets(), /TOKEN_ENCRYPTION_KEY:whitespace/);
  assert.throws(() => assertAdsWorkerProductionSecrets(), /TOKEN_ENCRYPTION_KEY:whitespace/);
  assert.throws(() => encryptSecret('stored-oauth-token'), /leading or trailing whitespace/);
  delete env.JWT_SECRET;
  env.TOKEN_ENCRYPTION_KEY = 'j'.repeat(40);
  assert.doesNotThrow(() => assertAdsWorkerProductionSecrets());
  assert.throws(() => assertAdsApiProductionSecrets(), /JWT_SECRET:missing/);

  const tsx = join(here, '../../../node_modules/tsx/dist/cli.mjs');
  const bootEnv = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: '',
    TOKEN_ENCRYPTION_KEY: 'k'.repeat(40),
    RAILWAY_ENVIRONMENT: '',
    RAILWAY_ENVIRONMENT_NAME: '',
    CEREVEX_REQUIRE_SIGNING_SECRETS: '',
    API_HOST: '127.0.0.1',
    API_PORT: '0',
    WORKER_PORT: '0',
  } as NodeJS.ProcessEnv;
  const workerBoot = await new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [tsx, 'src/index.ts'], {
      cwd: join(here, '../../ads/workers'),
      env: bootEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve({ code, output });
    };
    const timer = setTimeout(() => finish(null), 20000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('worker.listen')) finish(null);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => finish(code));
  });
  assert.equal(workerBoot.output.includes('worker.listen'), true, workerBoot.output);
  assert.equal(workerBoot.output.includes('JWT_SECRET'), false, workerBoot.output);
  const apiBootResult = await new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [tsx, 'src/index.ts'], {
      cwd: join(here, '../../ads/api'),
      env: bootEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: null, output });
    }, 20000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
  assert.equal(apiBootResult.code, 1, apiBootResult.output);
  assert.match(apiBootResult.output, /JWT_SECRET:missing/);
  assert.equal(apiBootResult.output.includes('k'.repeat(40)), false);
  const secrets = readFileSync(join(here, '../lib/prod-secrets.ts'), 'utf8');
  assert.match(secrets, /opsEnvRequiredInProduction\('brain'\)/);

  console.log('signing-runtime: ok');
} finally {
  restore();
}
