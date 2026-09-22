import { describe, expect, it } from "vitest";
import { containsRawSecret, decryptSecret, encryptSecret, redactSecrets } from "@tharros/shared";

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
});
