import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(secret: string) {
  // Derive a 32-byte key from the secret
  return scryptSync(secret, 'salt', 32);
}

export function encrypt(text: string, secret: string): string {
  if (!secret) {
    console.warn('ENCRYPTION_KEY not set - storing access token in plaintext (insecure!)');
    return text;
  }
  const key = getKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  // Format: iv:salt? no, we use fixed salt derivation: iv:encrypted:tag
  return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

export function decrypt(encryptedText: string, secret: string): string {
  if (!secret) {
    console.warn('ENCRYPTION_KEY not set - assuming access token is plaintext');
    return encryptedText;
  }
  const key = getKey(secret);
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const tag = Buffer.from(parts[2], 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
