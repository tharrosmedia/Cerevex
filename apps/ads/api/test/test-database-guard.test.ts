import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessTestDatabase,
  assertSafeTestDatabase,
  type AssessTestDatabaseInput,
} from "@tharros/ads-shared/test-database";

const CI_URL = "postgres://tharros:tharros@127.0.0.1:54329/tharros?options=-csearch_path%3Dos";

function assess(
  databaseUrl: string | undefined,
  env: Record<string, string | undefined> = {},
  extra: Partial<AssessTestDatabaseInput> = {},
) {
  return assessTestDatabase({ databaseUrl, env, purpose: "unit test", ...extra });
}

describe("test database guard", () => {
  it("allows the CI localhost URL and other loopback hosts", () => {
    expect(assess(CI_URL).allowed).toBe(true);
    expect(assess("postgres://tharros:tharros@localhost:54329/tharros").allowed).toBe(true);
    expect(assess("postgres://tharros:tharros@[::1]:5432/tharros").allowed).toBe(true);
    expect(assess("postgresql://user:secret@127.0.0.1/db").host).toBe("127.0.0.1");
  });

  it("allows a known test database and a marked Neon branch without the opt-in", () => {
    expect(assess("postgres://user:secret@db.internal.example:5432/cerevex_test").allowed).toBe(true);
    expect(assess("postgres://user:secret@db.internal.example:5432/cerevex-test").allowed).toBe(true);
    expect(assess("postgres://user:secret@ci.example.com:5432/app").allowed).toBe(true);
    expect(assess("postgres://user:secret@ep-branch-demo.us-east-2.aws.neon.tech/neondb").allowed).toBe(true);
    expect(assess("postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/preview").allowed).toBe(true);
    expect(
      assess("postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?branch=dev").allowed,
    ).toBe(true);
  });

  it("refuses a remote host unless ALLOW_NONLOCAL_TEST_DB=1, and does not echo the password", () => {
    const url = "postgres://user:super-secret@db.example.com:5432/app";
    const refused = assess(url, { ALLOW_NONLOCAL_TEST_DB: "true" });
    expect(refused.allowed).toBe(false);
    expect(refused.host).toBe("db.example.com");
    expect(refused.message).toContain('host "db.example.com"');
    expect(refused.message).not.toContain("super-secret");
    expect(assess(url, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(true);
  });

  it("refuses an unmarked Neon host unless opted in, and never the identified production host", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const direct = `postgres://user:super-secret@${prod}/neondb`;
    const pooler = "postgres://user:super-secret@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb";
    expect(assess(direct).allowed).toBe(false);
    expect(assess(direct, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(true);

    const env = { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: prod };
    const blocked = assess(pooler, env);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain("production Neon host");
    expect(blocked.message).not.toContain("super-secret");
    expect(assess(CI_URL, env).allowed).toBe(true);

    const fromUrl = assess(direct, {
      ALLOW_NONLOCAL_TEST_DB: "1",
      PRODUCTION_DATABASE_URL: `postgres://owner:other-secret@${prod}/neondb`,
    });
    expect(fromUrl.allowed).toBe(false);
    expect(fromUrl.message).not.toContain("other-secret");
  });

  it("treats a missing URL as safe for tests and unsafe for seed", () => {
    expect(assess(undefined).allowed).toBe(true);
    expect(assess(undefined, {}, { requireUrl: true }).allowed).toBe(false);
    expect(assess("not a url").allowed).toBe(false);
  });

  it("exits non-zero with the refusal and does not exit when the URL is local", () => {
    const writes: string[] = [];
    const codes: number[] = [];
    assertSafeTestDatabase({
      databaseUrl: "postgres://user:secret@db.example.com/app",
      env: {},
      purpose: "ads API tests",
      write: (message) => writes.push(message),
      exit: (code) => {
        codes.push(code);
      },
    });
    expect(codes).toEqual([1]);
    expect(writes[0]).toContain("Refusing to run ads API tests");
    expect(writes[0]).not.toContain("secret");

    const allowedCodes: number[] = [];
    assertSafeTestDatabase({
      databaseUrl: CI_URL,
      env: {},
      exit: (code) => {
        allowedCodes.push(code);
      },
    });
    expect(allowedCodes).toEqual([]);
  });

  it("is wired into the ads seed script and every ads API test entrypoint", () => {
    const seed = readFileSync(new URL("../../shared/src/seed.ts", import.meta.url), "utf8");
    const setup = readFileSync(new URL("./setup-database-guard.ts", import.meta.url), "utf8");
    const vitest = readFileSync(new URL("../vitest.config.ts", import.meta.url), "utf8");
    expect(seed).toContain("assertSafeTestDatabase");
    expect(seed).toContain('purpose: "the ads database seed"');
    expect(setup).toContain("assertSafeTestDatabase");
    expect(vitest).toContain("./test/setup-database-guard.ts");
  });
});
