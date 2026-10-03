import assert from 'node:assert/strict';
import {
  assertEncryptionConfigured,
  clearPlaintextAtRestFindings,
  decrypt,
  encrypt,
  isEncryptedPayload,
  notePlaintextAtRest,
  plaintextAtRestFindings,
  plaintextSecretsAllowed,
} from '../src/lib/encryption';

const env = process.env as Record<string, string | undefined>;
const prev = {
  NODE_ENV: env.NODE_ENV,
  RAILWAY_ENVIRONMENT: env.RAILWAY_ENVIRONMENT,
  ENCRYPTION_KEY: env.ENCRYPTION_KEY,
  ALLOW_PLAINTEXT_SECRETS: env.ALLOW_PLAINTEXT_SECRETS,
};

function restore() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

try {
  delete env.RAILWAY_ENVIRONMENT;
  delete env.ALLOW_PLAINTEXT_SECRETS;
  env.NODE_ENV = 'test';
  env.ENCRYPTION_KEY = 'test-encryption-key';
  clearPlaintextAtRestFindings();

  const cipher = encrypt('shpat_secret', env.ENCRYPTION_KEY);
  assert.equal(isEncryptedPayload(cipher), true);
  assert.notEqual(cipher, 'shpat_secret');
  assert.equal(decrypt(cipher, env.ENCRYPTION_KEY), 'shpat_secret');

  assert.throws(() => decrypt('plaintext-shop-token', env.ENCRYPTION_KEY, {
    source: 'stores.shopify_access_token',
    field: 'shopify_access_token',
    storeId: 'store-9',
  }));
  const found = plaintextAtRestFindings();
  assert.equal(found.length, 1);
  assert.equal(found[0]?.storeId, 'store-9');
  assert.equal(found[0]?.field, 'shopify_access_token');
  notePlaintextAtRest({ source: 'stores.shopify_access_token', field: 'shopify_access_token', storeId: 'store-9' });
  assert.equal(plaintextAtRestFindings().length, 1);

  delete env.ENCRYPTION_KEY;
  assert.equal(plaintextSecretsAllowed(), false);
  assert.throws(() => encrypt('shpat_secret'));
  assert.throws(() => decrypt('plaintext-shop-token'));

  env.ALLOW_PLAINTEXT_SECRETS = '1';
  assert.equal(plaintextSecretsAllowed(), true);
  assert.equal(encrypt('shpat_secret'), 'shpat_secret');
  clearPlaintextAtRestFindings();
  assert.equal(decrypt('shpat_secret'), 'shpat_secret');
  assert.equal(plaintextAtRestFindings()[0]?.source, 'decrypt');

  env.NODE_ENV = 'production';
  assert.equal(plaintextSecretsAllowed(), false);
  assert.throws(() => encrypt('shpat_secret'), /ENCRYPTION_KEY is required/);
  assert.throws(() => decrypt('shpat_secret'), /ENCRYPTION_KEY is required/);
  assert.throws(() => assertEncryptionConfigured(), /ENCRYPTION_KEY is required in production/);
  env.ENCRYPTION_KEY = 'prod-key';
  assert.doesNotThrow(() => assertEncryptionConfigured());
  const prod = encrypt('token', env.ENCRYPTION_KEY);
  assert.equal(isEncryptedPayload(prod), true);
  assert.notEqual(prod, 'token');

  env.NODE_ENV = 'test';
  env.RAILWAY_ENVIRONMENT = 'production';
  delete env.ENCRYPTION_KEY;
  env.ALLOW_PLAINTEXT_SECRETS = '1';
  assert.equal(plaintextSecretsAllowed(), false);
  assert.throws(() => encrypt('token'));

  console.log('encryption: ok');
} finally {
  restore();
  clearPlaintextAtRestFindings();
}
