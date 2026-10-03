import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_DEV_TOKEN_KEY } from "@cerevex/contracts";
import { containsRawSecret, decryptSecret, encryptSecret, redactSecrets } from "@tharros/ads-shared/crypto";
import {
  assertAdsApiProductionSecrets,
  assertAdsWorkerProductionSecrets,
} from "@tharros/ads-shared/production-secrets";

/** Pre-#63 derivation: raw value, UTF-16 length, no trim. */
function encryptLegacy(plaintext: string, raw: string): string {
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : raw.length === 32
      ? Buffer.from(raw, "utf8")
      : scryptSync(raw, "tharros-os-token", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

const env = process.env as Record<string, string | undefined>;
const prev = {
  NODE_ENV: env.NODE_ENV,
  RAILWAY_ENVIRONMENT: env.RAILWAY_ENVIRONMENT,
  RAILWAY_ENVIRONMENT_NAME: env.RAILWAY_ENVIRONMENT_NAME,
  CEREVEX_REQUIRE_SIGNING_SECRETS: env.CEREVEX_REQUIRE_SIGNING_SECRETS,
  TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
  JWT_SECRET: env.JWT_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe("token encryption", () => {
  it("round-trips secrets and redacts them for logs", () => {
    const secret = "EAABmocktokenvalue0000000000001";
    const packed = encryptSecret(JSON.stringify({ accessToken: secret }));
    expect(packed).not.toContain(secret);
    expect(JSON.parse(decryptSecret(packed)).accessToken).toBe(secret);

    const redacted = redactSecrets({ accessToken: secret, ok: true });
    expect(redacted.accessToken).toBe("[redacted]");
    expect(redacted.ok).toBe(true);
    expect(containsRawSecret({ accessToken: secret })).toBe(true);
    expect(containsRawSecret(redacted)).toBe(false);
  });

  it("rejects a missing, short, or placeholder token key in a production runtime", () => {
    env.NODE_ENV = "test";
    delete env.RAILWAY_ENVIRONMENT;
    delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
    env.JWT_SECRET = "c".repeat(32);
    env.RAILWAY_ENVIRONMENT_NAME = "staging";
    delete env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptSecret("token")).toThrow(/TOKEN_ENCRYPTION_KEY is missing in production/);
    expect(() => assertAdsApiProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:missing/);
    expect(() => assertAdsWorkerProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:missing/);
    env.TOKEN_ENCRYPTION_KEY = "abc";
    expect(() => encryptSecret("token")).toThrow(/TOKEN_ENCRYPTION_KEY is short in production/);
    expect(() => assertAdsApiProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:short/);
    env.TOKEN_ENCRYPTION_KEY = LOCAL_DEV_TOKEN_KEY.toUpperCase();
    expect(() => encryptSecret("token")).toThrow(/TOKEN_ENCRYPTION_KEY is placeholder in production/);
    expect(() => assertAdsWorkerProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:placeholder/);
    env.TOKEN_ENCRYPTION_KEY = "d".repeat(32);
    expect(() => assertAdsApiProductionSecrets()).not.toThrow();
    expect(() => assertAdsWorkerProductionSecrets()).not.toThrow();
    const packed = encryptSecret("token");
    expect(decryptSecret(packed)).toBe("token");
  });

  it("decrypts ciphertext from the pre-trim derivation and refuses a padded key in production", () => {
    env.NODE_ENV = "test";
    delete env.RAILWAY_ENVIRONMENT;
    delete env.RAILWAY_ENVIRONMENT_NAME;
    delete env.CEREVEX_REQUIRE_SIGNING_SECRETS;
    const padded = ["e".repeat(32) + "\n", " " + "f".repeat(40), "ab".repeat(32) + " ", "g".repeat(32) + " "];
    for (const raw of padded) {
      env.TOKEN_ENCRYPTION_KEY = raw;
      const payload = encryptLegacy("stored-oauth-token", raw);
      expect(decryptSecret(payload)).toBe("stored-oauth-token");
    }
    env.NODE_ENV = "production";
    env.JWT_SECRET = "h".repeat(40);
    env.TOKEN_ENCRYPTION_KEY = " " + "i".repeat(40);
    expect(() => assertAdsApiProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:whitespace/);
    expect(() => assertAdsWorkerProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:whitespace/);
    expect(() => encryptSecret("stored-oauth-token")).toThrow(/leading or trailing whitespace/);
    delete env.JWT_SECRET;
    env.TOKEN_ENCRYPTION_KEY = "j".repeat(40);
    expect(() => assertAdsWorkerProductionSecrets()).not.toThrow();
    expect(() => assertAdsApiProductionSecrets()).toThrow(/JWT_SECRET:missing/);
  });
});
