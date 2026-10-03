import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { encryptionKeyProblem, isProductionRuntime } from '../../lib/runtime-env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type PlaintextAtRestFinding = {
  source: string;
  field: string;
  storeId?: string;
};

const plaintextFindings: PlaintextAtRestFinding[] = [];

export function plaintextAtRestFindings(): readonly PlaintextAtRestFinding[] {
  return plaintextFindings;
}

export function clearPlaintextAtRestFindings(): void {
  plaintextFindings.length = 0;
}

/** Log a plaintext row seen on a read path. Does not write it back. */
export function notePlaintextAtRest(finding: PlaintextAtRestFinding): void {
  const seen = plaintextFindings.some(
    (row) => row.source === finding.source && row.field === finding.field && row.storeId === finding.storeId,
  );
  if (seen) return;
  plaintextFindings.push(finding);
  console.warn(
    `[encryption] plaintext row at rest field=${finding.field} source=${finding.source} store=${finding.storeId ?? 'n/a'}. Not migrated.`,
  );
}

export function isEncryptedPayload(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [iv, data, tag] = parts;
  if (!/^[0-9a-fA-F]{24}$/.test(iv)) return false;
  if (!/^[0-9a-fA-F]{32}$/.test(tag)) return false;
  if (!/^[0-9a-fA-F]*$/.test(data) || data.length % 2 !== 0) return false;
  return true;
}

export function plaintextSecretsAllowed(): boolean {
  if (isProductionRuntime()) return false;
  return process.env.ALLOW_PLAINTEXT_SECRETS === '1';
}

const WHITESPACE_KEY =
  'ENCRYPTION_KEY has leading or trailing whitespace. Refusing to trim it so existing ciphertexts stay byte-identical.';

export function assertEncryptionConfigured(): void {
  if (!isProductionRuntime()) return;
  const problem = encryptionKeyProblem();
  if (problem === 'whitespace') throw new Error(WHITESPACE_KEY);
  if (problem === 'missing') {
    throw new Error('ENCRYPTION_KEY is required in production. Refusing to boot with a plaintext fallback.');
  }
}

export function resolveEncryptionSecret(secret?: string | null): string {
  const raw = secret != null && secret !== '' ? secret : (process.env.ENCRYPTION_KEY ?? '');
  if (raw !== raw.trim()) throw new Error(WHITESPACE_KEY);
  if (raw) return raw;
  if (plaintextSecretsAllowed()) return '';
  throw new Error('ENCRYPTION_KEY is required. Refusing to store or read secrets as plaintext.');
}

function getKey(secret: string) {
  return scryptSync(secret, 'salt', 32);
}

export function encrypt(text: string, secret?: string | null): string {
  const key = resolveEncryptionSecret(secret);
  if (!key) {
    console.warn('ALLOW_PLAINTEXT_SECRETS=1 and ENCRYPTION_KEY is unset — storing this secret as plaintext (dev/test only)');
    return text;
  }
  const derived = getKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derived, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LENGTH) {
    throw new Error('Unexpected auth tag length');
  }
  return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

export function decrypt(encryptedText: string, secret?: string | null, where?: PlaintextAtRestFinding): string {
  const key = resolveEncryptionSecret(secret);
  if (!key) {
    if (isEncryptedPayload(encryptedText)) {
      throw new Error('ENCRYPTION_KEY is required to decrypt stored secrets.');
    }
    notePlaintextAtRest(where ?? { source: 'decrypt', field: 'secret' });
    return encryptedText;
  }
  if (!isEncryptedPayload(encryptedText)) {
    notePlaintextAtRest(where ?? { source: 'decrypt', field: 'secret' });
    throw new Error('Stored secret is plaintext. Refusing to use it. No migration was performed.');
  }
  const derived = getKey(key);
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const tag = Buffer.from(parts[2], 'hex');
  const decipher = createDecipheriv(ALGORITHM, derived, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
