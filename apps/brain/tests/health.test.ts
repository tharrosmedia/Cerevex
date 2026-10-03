import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET } from '../app/api/health/route';
import { assertProductionSecrets, shouldCheckProductionSecrets } from '../lib/prod-secrets';

const env = process.env as Record<string, string | undefined>;
const keys = ['NODE_ENV', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'ENCRYPTION_KEY', 'GSC_OAUTH_STATE_SECRET', 'APP_PASSWORD', 'ADS_INTERNAL_KEY'] as const;
const prev = Object.fromEntries(keys.map((key) => [key, env[key]]));

function restore() {
  for (const key of keys) {
    const value = prev[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

function clearSecrets() {
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.ENCRYPTION_KEY;
  delete env.GSC_OAUTH_STATE_SECRET;
  delete env.APP_PASSWORD;
  delete env.ADS_INTERNAL_KEY;
}

try {
  clearSecrets();
  env.NODE_ENV = 'test';
  assert.equal((await GET()).status, 200);
  assert.doesNotThrow(() => assertProductionSecrets());

  env.NODE_ENV = 'production';
  const missing = await GET();
  assert.equal(missing.status, 503);
  const missingBody = await missing.json();
  assert.equal(missingBody.ok, false);
  assert.equal(JSON.stringify(missingBody).includes('shpat'), false);
  assert.throws(() => assertProductionSecrets(), /ENCRYPTION_KEY:missing/);

  env.ENCRYPTION_KEY = ' prod-key ';
  env.GSC_OAUTH_STATE_SECRET = 'gsc-secret';
  env.APP_PASSWORD = 'console-secret';
  env.ADS_INTERNAL_KEY = 'internal-secret';
  assert.equal((await GET()).status, 503);
  assert.throws(() => assertProductionSecrets(), /ENCRYPTION_KEY:whitespace/);

  env.ENCRYPTION_KEY = 'prod-key';
  const ready = await GET();
  assert.equal(ready.status, 200);
  assert.doesNotThrow(() => assertProductionSecrets());

  const here = dirname(fileURLToPath(import.meta.url));
  const instrumentation = readFileSync(join(here, '../instrumentation.ts'), 'utf8');
  const secrets = readFileSync(join(here, '../lib/prod-secrets.ts'), 'utf8');
  assert.match(instrumentation, /NEXT_RUNTIME === "nodejs"/);
  assert.match(instrumentation, /import\("\.\/lib\/prod-secrets"\)/);
  assert.match(instrumentation, /process\.exit\(1\)/);
  assert.match(instrumentation, /npm run start/);
  assert.doesNotMatch(instrumentation, /from ["']\.\/src\/lib\/encryption["']/);
  assert.match(secrets, /phase-production-build/);
  assert.match(secrets, /npm_lifecycle_event === 'build'/);
  const prevPhase = env.NEXT_PHASE;
  const prevLifecycle = env.npm_lifecycle_event;
  env.NEXT_PHASE = 'phase-production-build';
  env.npm_lifecycle_event = 'start';
  assert.equal(shouldCheckProductionSecrets(), false);
  delete env.NEXT_PHASE;
  env.npm_lifecycle_event = 'build';
  assert.equal(shouldCheckProductionSecrets(), false);
  env.npm_lifecycle_event = 'start';
  assert.equal(shouldCheckProductionSecrets(), true);
  if (prevPhase === undefined) delete env.NEXT_PHASE;
  else env.NEXT_PHASE = prevPhase;
  if (prevLifecycle === undefined) delete env.npm_lifecycle_event;
  else env.npm_lifecycle_event = prevLifecycle;

  console.log('health: ok');
} finally {
  restore();
}
