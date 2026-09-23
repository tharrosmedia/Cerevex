import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { loadEnv } from "./env";

const LOCAL_DEV_KEY = "local-dev-only-token-key-32b!!";

function encryptionKey(): Buffer {
  loadEnv();
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENCRYPTION_KEY is required in production");
    }
    return Buffer.from(LOCAL_DEV_KEY, "utf8");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  if (raw.length === 32) {
    return Buffer.from(raw, "utf8");
  }
  return scryptSync(raw, "tharros-os-token", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

const SECRET_KEYS = new Set([
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "encryptedPayload",
  "encrypted_payload",
  "encryptedApiKey",
  "encrypted_api_key",
  "apiKey",
  "api_key",
  "id_token",
  "client_secret",
  "TOKEN_ENCRYPTION_KEY",
  "CALLRAIL_API_KEY",
]);

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) {
        out[key] = typeof inner === "string" && inner.length > 0 ? "[redacted]" : inner;
      } else {
        out[key] = redactSecrets(inner);
      }
    }
    return out as T;
  }
  return value;
}

export function containsRawSecret(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      value.includes("accessToken") ||
      value.includes("refreshToken") ||
      value.includes("encryptedPayload") ||
      /mock-access-|EAA[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,}/.test(value)
    );
  }
  if (Array.isArray(value)) return value.some(containsRawSecret);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, inner]) => {
      if (SECRET_KEYS.has(key) && typeof inner === "string" && inner.length > 0 && inner !== "[redacted]") {
        return true;
      }
      return containsRawSecret(inner);
    });
  }
  return false;
}
