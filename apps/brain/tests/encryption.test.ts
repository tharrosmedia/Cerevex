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
  readStoredSecret,
} from '../src/lib/encryption';

const env = process.env as Record<string, string | undefined>;
const prev = {
  NODE_ENV: env.NODE_ENV,
  RAILWAY_ENVIRONMENT: env.RAILWAY_ENVIRONMENT,
  RAILWAY_ENVIRONMENT_NAME: env.RAILWAY_ENVIRONMENT_NAME,
  CEREVEX_REQUIRE_SIGNING_SECRETS: env.CEREVEX_REQUIRE_SIGNING_SECRETS,
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
  delete env.RAILWAY_ENVIRONMENT_NAME;
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

  delete env.RAILWAY_ENVIRONMENT;
  env.RAILWAY_ENVIRONMENT_NAME = 'Production';
  assert.equal(plaintextSecretsAllowed(), false);
  assert.throws(() => assertEncryptionConfigured(), /ENCRYPTION_KEY is required in production/);

  env.NODE_ENV = ' Production ';
  delete env.RAILWAY_ENVIRONMENT_NAME;
  assert.equal(plaintextSecretsAllowed(), false);
  assert.throws(() => assertEncryptionConfigured(), /ENCRYPTION_KEY is required in production/);

  env.NODE_ENV = 'test';
  env.RAILWAY_ENVIRONMENT_NAME = 'staging';
  delete env.ENCRYPTION_KEY;
  env.ALLOW_PLAINTEXT_SECRETS = '1';
  assert.equal(plaintextSecretsAllowed(), false);
  assert.throws(() => assertEncryptionConfigured(), /ENCRYPTION_KEY is required in production/);
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.CEREVEX_REQUIRE_SIGNING_SECRETS = '1';
  assert.equal(plaintextSecretsAllowed(), false);
  delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;

  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.NODE_ENV = 'test';
  const exactKey = 'abc';
  const cipherExact = encrypt('secret-value', exactKey);
  assert.equal(decrypt(cipherExact, exactKey), 'secret-value');
  assert.throws(() => decrypt(cipherExact, ' abc '), /leading or trailing whitespace/);
  assert.throws(() => encrypt('secret-value', ' abc '), /leading or trailing whitespace/);
  env.ENCRYPTION_KEY = ' abc ';
  env.NODE_ENV = 'production';
  assert.throws(() => assertEncryptionConfigured(), /leading or trailing whitespace/);
  assert.throws(() => encrypt('secret-value'), /leading or trailing whitespace/);

  env.NODE_ENV = 'test';
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  delete env.ENCRYPTION_KEY;
  env.ALLOW_PLAINTEXT_SECRETS = '1';
  clearPlaintextAtRestFindings();
  const plain = encrypt('shpat_roundtrip');
  assert.equal(plain, 'shpat_roundtrip');
  assert.equal(readStoredSecret(plain, { source: 'stores.shopify_access_token', field: 'shopify_access_token', storeId: 'store-1' }), 'shpat_roundtrip');
  delete env.ALLOW_PLAINTEXT_SECRETS;
  assert.equal(readStoredSecret(plain, { source: 'stores.shopify_access_token', field: 'shopify_access_token', storeId: 'store-1' }), '');

  console.log('encryption: ok');
} finally {
  restore();
  clearPlaintextAtRestFindings();
}
