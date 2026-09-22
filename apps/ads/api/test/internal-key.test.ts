import { afterEach, describe, expect, it } from "vitest";
import { extractInternalKey, internalKeyMatches } from "../src/auth";

const ORIGINAL = process.env.ADS_INTERNAL_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADS_INTERNAL_KEY;
  else process.env.ADS_INTERNAL_KEY = ORIGINAL;
});

describe("internal key", () => {
  it("rejects missing or mismatched keys", () => {
    process.env.ADS_INTERNAL_KEY = "shared-console-key";
    expect(internalKeyMatches(undefined)).toBe(false);
    expect(internalKeyMatches("wrong")).toBe(false);
    expect(internalKeyMatches("shared-console-key")).toBe(true);
    expect(extractInternalKey("  shared-console-key  ")).toBe("shared-console-key");
  });

  it("is disabled when unset", () => {
    delete process.env.ADS_INTERNAL_KEY;
    expect(internalKeyMatches("shared-console-key")).toBe(false);
  });
});
