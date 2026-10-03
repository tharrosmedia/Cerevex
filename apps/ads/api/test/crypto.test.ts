import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_DEV_TOKEN_KEY } from "@cerevex/contracts";
import { containsRawSecret, decryptSecret, encryptSecret, redactSecrets } from "@tharros/ads-shared/crypto";
import { assertAdsProductionSecrets } from "@tharros/ads-shared/production-secrets";

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
    expect(() => assertAdsProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:missing/);
    env.TOKEN_ENCRYPTION_KEY = "abc";
    expect(() => encryptSecret("token")).toThrow(/TOKEN_ENCRYPTION_KEY is short in production/);
    expect(() => assertAdsProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:short/);
    env.TOKEN_ENCRYPTION_KEY = LOCAL_DEV_TOKEN_KEY.toUpperCase();
    expect(() => encryptSecret("token")).toThrow(/TOKEN_ENCRYPTION_KEY is placeholder in production/);
    expect(() => assertAdsProductionSecrets()).toThrow(/TOKEN_ENCRYPTION_KEY:placeholder/);
    env.TOKEN_ENCRYPTION_KEY = "d".repeat(32);
    expect(() => assertAdsProductionSecrets()).not.toThrow();
    const packed = encryptSecret("token");
    expect(decryptSecret(packed)).toBe("token");
  });
});
