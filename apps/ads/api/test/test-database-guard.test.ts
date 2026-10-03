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
    expect(assess("postgres://user:secret@db.internal.example:5432/test").allowed).toBe(true);
    expect(assess("postgres://user:secret@ci.example.com:5432/app").allowed).toBe(true);
    expect(assess("postgres://user:secret@ep-branch-demo.us-east-2.aws.neon.tech/neondb").allowed).toBe(true);
    expect(assess("postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/preview").allowed).toBe(true);
    expect(assess("postgres://user:secret@br-cool-branch.us-east-2.aws.neon.tech/neondb").allowed).toBe(true);
    expect(
      assess("postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?branch=dev").allowed,
    ).toBe(false);
    expect(
      assess("postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?branch=br-cool").allowed,
    ).toBe(false);
  });

  it("refuses database names that only contain test as a substring", () => {
    expect(assess("postgres://user:secret@db.example.com/contest").allowed).toBe(false);
    expect(assess("postgres://user:secret@db.example.com/my_test_prod").allowed).toBe(false);
    expect(assess("postgres://user:secret@db.example.com/latest").allowed).toBe(false);
  });

  it("uses the host node-postgres would connect to, including ?host= and multi-host lists", () => {
    const remoteOverride = assess("postgres://user:pw@localhost/db?host=db.example.com");
    expect(remoteOverride.allowed).toBe(false);
    expect(remoteOverride.host).toBe("db.example.com");
    expect(remoteOverride.message).not.toContain("pw");

    const localOverride = assess("postgres://user:pw@db.example.com/db?host=localhost");
    expect(localOverride.allowed).toBe(true);
    expect(localOverride.host).toBe("localhost");

    expect(assess("postgres://user:pw@localhost/db?host=127.0.0.1,db.example.com").allowed).toBe(false);
    expect(assess("postgres://user:pw@localhost/db?host=localhost,127.0.0.1").allowed).toBe(true);
    expect(assess("postgres://user:pw@localhost/db?host=/var/run/postgresql").allowed).toBe(true);

    // This driver connects to `host`, not `hostaddr`.
    expect(assess("postgres://user:pw@localhost/db?hostaddr=8.8.8.8").allowed).toBe(true);
    expect(assess("postgres://user:pw@db.example.com/db?hostaddr=127.0.0.1").allowed).toBe(false);
  });

  it("does not treat a br- substring as a Neon branch marker", () => {
    const hidden = assess(
      "postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?note=see-br-hidden",
    );
    expect(hidden.allowed).toBe(false);
    expect(
      assess("postgres://user:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb-br-extra").allowed,
    ).toBe(false);
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

    const queryHost = assess(direct, {
      ALLOW_NONLOCAL_TEST_DB: "1",
      PRODUCTION_DATABASE_URL: `postgres://owner:other-secret@localhost/neondb?host=${prod}`,
    });
    expect(queryHost.allowed).toBe(false);
    expect(queryHost.message).not.toContain("other-secret");
  });

  it("fails closed when PRODUCTION_DATABASE_URL is set but cannot be parsed", () => {
    const broken = assess(CI_URL, { PRODUCTION_DATABASE_URL: "not a url" });
    expect(broken.allowed).toBe(false);
    expect(broken.message).toContain("PRODUCTION_DATABASE_URL is set but could not be parsed");
    expect(broken.message).not.toContain("not a url");

    const invalid = assess(CI_URL, {
      PRODUCTION_DATABASE_URL: "postgres://user:super-secret@host1:5432,host2:5433/db",
    });
    expect(invalid.allowed).toBe(false);
    expect(invalid.message).not.toContain("super-secret");

    expect(assess(CI_URL, { PRODUCTION_DATABASE_URL: "" }).allowed).toBe(true);
    expect(assess(CI_URL, { PRODUCTION_DATABASE_URL: "   " }).allowed).toBe(true);
    expect(assess(CI_URL, { PRODUCTION_NEON_HOST: "  \n" }).allowed).toBe(true);
    expect(assess(CI_URL, {}).allowed).toBe(true);
  });

  it("reads PRODUCTION_NEON_HOST from a bare host, host:port, or any scheme URL", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const pooler = `postgres://user:super-secret@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb`;
    const direct = `postgres://user:super-secret@${prod}/neondb?branch=dev`;
    const forms = [
      prod,
      `${prod}:5432`,
      `HTTPS://${prod}/console`,
      `https://user:other-secret@${prod}/console`,
      `postgres://owner:other-secret@${prod}/neondb`,
      `postgresql://owner:other-secret@${prod}:5432/neondb`,
    ];
    for (const listed of forms) {
      const blocked = assess(pooler, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: listed });
      expect(blocked.allowed, listed).toBe(false);
      expect(blocked.message).toContain("production Neon host");
      expect(blocked.message).not.toContain("super-secret");
      expect(blocked.message).not.toContain("other-secret");
      expect(assess(direct, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: listed }).allowed).toBe(false);
      expect(assess(CI_URL, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: listed }).allowed).toBe(true);
    }
  });

  it("fails closed when PRODUCTION_NEON_HOST is non-empty but has no hostname", () => {
    for (const listed of ["https://", "https://user:super-secret@", "not a host", "postgres://user:pw@host1:5432,host2:5433/db"]) {
      const refused = assess(CI_URL, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: listed });
      expect(refused.allowed, listed).toBe(false);
      expect(refused.message).toContain("PRODUCTION_NEON_HOST is set but could not be parsed");
      expect(refused.message).not.toContain("super-secret");
    }
  });

  it("does not let a branch query param whitelist the production endpoint", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const branched = `postgres://user:secret@${prod}/neondb?branch=dev`;
    const endpointBranch = "ep-branch-demo.us-east-2.aws.neon.tech";
    expect(assess(branched).allowed).toBe(false);
    expect(assess(branched, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(true);
    expect(
      assess(branched, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: `https://${prod}` }).allowed,
    ).toBe(false);
    expect(
      assess(`postgres://user:secret@${endpointBranch}/neondb?branch=anything`, {
        ALLOW_NONLOCAL_TEST_DB: "1",
        PRODUCTION_NEON_HOST: endpointBranch,
      }).allowed,
    ).toBe(false);
    expect(assess(`postgres://user:secret@${endpointBranch}/neondb`).allowed).toBe(true);
  });

  it("denies the driver host when PRODUCTION_NEON_HOST is a postgres URL with ?host=", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const listed = `postgres://u:p@localhost/db?host=${prod}`;
    const target = `postgres://user:super-secret@${prod}/neondb`;
    const env = { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: listed };
    const blocked = assess(target, env);
    expect(blocked.allowed).toBe(false);
    expect(blocked.host).toBe(prod);
    expect(blocked.message).not.toContain("super-secret");
    expect(assess(CI_URL, env).allowed).toBe(true);
    expect(
      assess(target, {
        ALLOW_NONLOCAL_TEST_DB: "1",
        PRODUCTION_DATABASE_URL: `postgresql://u:p@localhost/db?host=${prod}`,
      }).allowed,
    ).toBe(false);
  });

  it("strips trailing dots so the production host and a test database name still refuse", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const dotted = `postgres://user:secret@${prod}./x_test`;
    expect(assess(dotted, { PRODUCTION_NEON_HOST: prod }).allowed).toBe(false);
    expect(assess(dotted, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: prod }).allowed).toBe(false);
    expect(
      assess(`postgres://user:secret@${prod}/neondb`, {
        ALLOW_NONLOCAL_TEST_DB: "1",
        PRODUCTION_NEON_HOST: `${prod}.`,
      }).allowed,
    ).toBe(false);
    expect(assess("postgres://user:secret@db.example.com./cerevex_test").allowed).toBe(true);
  });

  it("rejects hostnames with empty or hyphen-edged labels", () => {
    for (const listed of ["-.", "..", "-bad.example", "bad-.example", "foo..bar", "a..b"]) {
      const refused = assess(CI_URL, { PRODUCTION_NEON_HOST: listed });
      expect(refused.allowed, listed).toBe(false);
      expect(refused.message).toContain("PRODUCTION_NEON_HOST is set but could not be parsed");
    }
    expect(assess(CI_URL, { PRODUCTION_NEON_HOST: "ep-ok.example." }).allowed).toBe(true);
  });

  it("denies a Neon options endpoint that matches the configured production endpoint", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const branchHost = "ep-branch-demo.us-east-2.aws.neon.tech";
    const withEndpoint = `postgres://user:secret@${branchHost}/neondb?options=${encodeURIComponent("endpoint=ep-cool-darkness-123456")}`;
    const withPooler = `postgres://user:secret@1.2.3.4/neondb?options=${encodeURIComponent("-c endpoint=ep-cool-darkness-123456-pooler")}`;
    const withProject = `postgres://user:secret@${branchHost}/neondb?options=${encodeURIComponent("project=ep-cool-darkness-123456")}`;
    const env = { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: prod };
    expect(assess(withEndpoint, env).allowed).toBe(false);
    expect(assess(withEndpoint, env).message).toContain("production Neon endpoint");
    expect(assess(withEndpoint, env).message).not.toContain("secret");
    expect(assess(withPooler, env).allowed).toBe(false);
    expect(assess(withProject, env).allowed).toBe(false);
    expect(assess(`postgres://user:secret@${branchHost}/neondb`, { PRODUCTION_NEON_HOST: prod }).allowed).toBe(true);
    expect(
      assess(
        `postgres://user:secret@${branchHost}/neondb?options=${encodeURIComponent("endpoint=ep-other-branch")}`,
        env,
      ).allowed,
    ).toBe(true);
  });

  it("refuses a Neon password endpoint id on an IP, including a test-looking database name", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const prodId = "ep-cool-darkness-123456";
    const dollar = `postgres://user:${encodeURIComponent(`endpoint=${prodId}$super-secret`)}@1.2.3.4/neondb`;
    const semicolon = `postgres://user:${encodeURIComponent(`endpoint=${prodId};super-secret`)}@1.2.3.4/neondb`;
    const env = { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: prod };
    expect(assess(dollar, env).allowed).toBe(false);
    expect(assess(dollar, env).message).not.toContain("super-secret");
    expect(assess(semicolon, env).allowed).toBe(false);
    const other = `postgres://user:${encodeURIComponent("endpoint=ep-other-branch$super-secret")}@1.2.3.4/x_test`;
    expect(assess(other, { PRODUCTION_NEON_HOST: prod }).allowed).toBe(false);
    expect(assess("postgres://user:pw@1.2.3.4/x_test").allowed).toBe(true);
    expect(
      assess(`postgres://user:${encodeURIComponent(`endpoint=${prodId}$super-secret`)}@127.0.0.1/cerevex_test`, env)
        .allowed,
    ).toBe(false);
    expect(
      assess(
        `postgres://user:${encodeURIComponent("endpoint=ep-other-branch$pw")}@127.0.0.1/cerevex_test`,
        { PRODUCTION_NEON_HOST: prod },
      ).allowed,
    ).toBe(true);
    expect(assess("postgres://user:pw@127.0.0.1/cerevex_test").allowed).toBe(true);
  });

  it("reads PGOPTIONS and PGPASSWORD when the URL omits them", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const branch = `postgres://user@ep-branch-demo.us-east-2.aws.neon.tech/neondb`;
    expect(
      assess(branch, {
        ALLOW_NONLOCAL_TEST_DB: "1",
        PRODUCTION_NEON_HOST: prod,
        PGOPTIONS: "endpoint=ep-cool-darkness-123456",
      }).allowed,
    ).toBe(false);
    expect(
      assess("postgres://user@1.2.3.4/neondb", {
        ALLOW_NONLOCAL_TEST_DB: "1",
        PRODUCTION_NEON_HOST: prod,
        PGPASSWORD: "endpoint=ep-cool-darkness-123456$super-secret",
      }).allowed,
    ).toBe(false);
    expect(
      assess("postgres://user:ordinary@127.0.0.1/cerevex_test", {
        PRODUCTION_NEON_HOST: prod,
        PGPASSWORD: "endpoint=ep-cool-darkness-123456$super-secret",
      }).allowed,
    ).toBe(true);
  });

  it("folds fullwidth and ideographic-dot hosts into the production deny list", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const fullwidth = prod.replace(/[a-z0-9]/g, (char) =>
      String.fromCharCode(char >= "0" && char <= "9" ? 0xff10 + char.charCodeAt(0) - 48 : 0xff41 + char.charCodeAt(0) - 97),
    );
    const ideographic = prod.replaceAll(".", "。");
    const target = `postgres://user:secret@${prod}/neondb`;
    expect(assess(target, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: fullwidth }).allowed).toBe(false);
    expect(assess(target, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_NEON_HOST: ideographic }).allowed).toBe(false);
    expect(assess(`postgres://user:secret@${ideographic}/neondb`, { PRODUCTION_NEON_HOST: prod }).allowed).toBe(false);
    expect(assess(CI_URL, { PRODUCTION_NEON_HOST: "xn--" }).allowed).toBe(false);
  });

  it("treats an options endpoint inside PRODUCTION_DATABASE_URL as the production endpoint", () => {
    const prodId = "ep-cool-darkness-123456";
    const prod = `${prodId}.us-east-2.aws.neon.tech`;
    const configured = `postgres://owner:other-secret@ep-other.us-east-2.aws.neon.tech/neondb?options=${encodeURIComponent(`endpoint=${prodId}`)}`;
    const target = `postgres://user:secret@${prod}/neondb`;
    const blocked = assess(target, { ALLOW_NONLOCAL_TEST_DB: "1", PRODUCTION_DATABASE_URL: configured });
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).not.toContain("other-secret");
    expect(assess(CI_URL, { PRODUCTION_DATABASE_URL: configured }).allowed).toBe(true);
    expect(
      assess(`postgres://user:secret@1.2.3.4/neondb?options=${encodeURIComponent(`endpoint=${prodId}`)}`, {
        ALLOW_NONLOCAL_TEST_DB: "1",
        PRODUCTION_DATABASE_URL: configured,
      }).allowed,
    ).toBe(false);
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

  it("refuses a double-encoded percent host that domainToASCII would call localhost", () => {
    const urlHost = assess("postgres://u:pw@local%2568ost/x");
    expect(urlHost.allowed).toBe(false);
    expect(urlHost.host).toBeNull();
    expect(urlHost.message).toContain("could not be parsed");
    expect(urlHost.message).not.toContain("pw");

    const queryHost = assess("postgres://u:pw@db.example.com/x?host=local%2568ost");
    expect(queryHost.allowed).toBe(false);
    expect(queryHost.host).toBeNull();
    expect(queryHost.message).toContain("could not be parsed");
    expect(queryHost.message).not.toContain("pw");

    expect(assess("postgres://u:pw@local%2568ost/x", { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(false);
    expect(assess("postgres://user:pw@127.1/app").allowed).toBe(true);
    expect(assess("postgres://user:pw@0x7f000001/app").allowed).toBe(true);
    expect(assess("postgres://user:pw@localhost/app").allowed).toBe(true);
  });

  it("does not treat mixed hex-decimal IPv4 text as loopback", () => {
    for (const host of ["127.0x.0x.1", "0x7f.0x.0x.1"]) {
      const asHost = assess(`postgres://u:pw@${host}/x`);
      const asQuery = assess(`postgres://u:pw@db.example.com/x?host=${host}`);
      expect(asHost.allowed, host).toBe(false);
      expect(asQuery.allowed, `?host=${host}`).toBe(false);
      expect(asHost.host, host).toBeNull();
      expect(asQuery.host, `?host=${host}`).toBeNull();
      expect(asHost.message, host).toContain("could not be parsed");
      expect(asHost.message, host).not.toContain("pw");
      expect(asQuery.message, `?host=${host}`).not.toContain("pw");
      expect(assess(`postgres://u:pw@${host}/x`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed, host).toBe(false);
      expect(
        assess(`postgres://u:pw@db.example.com/x?host=${host}`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed,
        `?host=${host}`,
      ).toBe(false);
    }

    for (const host of ["127.1", "0x7f000001", "0x7f.0.0.1", "127.0.0.1", "localhost"]) {
      expect(assess(`postgres://user:pw@${host}/app`).allowed, host).toBe(true);
      expect(assess(`postgres://user:pw@db.example.com/app?host=${host}`).host, `?host=${host}`).toBe(
        host === "127.0.0.1" || host === "localhost" ? host : "127.0.0.1",
      );
      expect(assess(`postgres://user:pw@db.example.com/app?host=${host}`).allowed, `?host=${host}`).toBe(true);
    }
  });

  it("does not treat a non-ASCII spelling of an inet_aton form as loopback", () => {
    const hosts = [
      "\uFF11\uFF12\uFF17.0x.0x.1",
      "127.0x.0x.\uFF11",
      "\uFF10\uFF58\uFF17\uFF46.\uFF10\uFF58.\uFF10\uFF58.\uFF11",
      "127\u30020x\u30020x\u30021",
      "127\uFF0E0x\uFF0E0x\uFF0E1",
      "127.0x\u00AD.0x.1",
      "127.0\u200Bx.0x.1",
    ];
    for (const host of hosts) {
      const encoded = encodeURIComponent(host);
      const asHost = assess(`postgres://u:pw@${encoded}/x`);
      const asQuery = assess(`postgres://u:pw@db.example.com/x?host=${encoded}`);
      expect(asHost.allowed, host).toBe(false);
      expect(asQuery.allowed, `?host=${host}`).toBe(false);
      expect(asHost.host, host).toBeNull();
      expect(asQuery.host, `?host=${host}`).toBeNull();
      expect(asHost.message, host).toContain("could not be parsed");
      expect(asHost.message, host).not.toContain("pw");
      expect(asQuery.message, `?host=${host}`).not.toContain("pw");
      expect(assess(`postgres://u:pw@${encoded}/x`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed, host).toBe(false);
      expect(
        assess(`postgres://u:pw@db.example.com/x?host=${encoded}`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed,
        `?host=${host}`,
      ).toBe(false);
    }
  });

  it("refuses extra trailing dots and a trailing dot on an inet_aton rewrite", () => {
    for (const host of ["127.1.", "0x7f000001.", "0x7f.0.0.1.", "127.0.0.1..", "localhost.."]) {
      const asHost = assess(`postgres://u:pw@${host}/x`);
      const asQuery = assess(`postgres://u:pw@db.example.com/x?host=${encodeURIComponent(host)}`);
      expect(asHost.allowed, host).toBe(false);
      expect(asQuery.allowed, `?host=${host}`).toBe(false);
      expect(asHost.host, host).toBeNull();
      expect(asQuery.host, `?host=${host}`).toBeNull();
      expect(asHost.message, host).toContain("could not be parsed");
      expect(asHost.message, host).not.toContain("pw");
      expect(asQuery.message, `?host=${host}`).not.toContain("pw");
      expect(assess(`postgres://u:pw@${host}/x`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed, host).toBe(false);
      expect(
        assess(`postgres://u:pw@db.example.com/x?host=${encodeURIComponent(host)}`, {
          ALLOW_NONLOCAL_TEST_DB: "1",
        }).allowed,
        `?host=${host}`,
      ).toBe(false);
    }

    expect(assess("postgres://user:pw@127.0.0.1./app").allowed).toBe(true);
    expect(assess("postgres://user:pw@localhost./app").allowed).toBe(true);
    expect(assess("postgres://user:pw@db.example.com/app?host=127.0.0.1.").host).toBe("127.0.0.1");
    expect(assess("postgres://user:pw@db.example.com/app?host=localhost.").host).toBe("localhost");
    expect(assess("postgres://user:pw@127.1/app").allowed).toBe(true);
    expect(assess("postgres://user:pw@0x7f000001/app").allowed).toBe(true);
  });

  it("refuses IDNA spellings that become two trailing dots", () => {
    const hosts = [
      "localhost\u3002\u3002",
      "localhost\uFF0E\uFF0E",
      "localhost\uFF61\uFF61",
      "localhost.\u3002",
      "localhost\u3002.",
      "localhost.\u00AD.",
      "localhost.\u200B.",
      "\uFF4C\uFF4F\uFF43\uFF41\uFF4C\uFF48\uFF4F\uFF53\uFF54\uFF0E\uFF0E",
    ];
    for (const host of hosts) {
      const encoded = encodeURIComponent(host);
      const asHost = assess(`postgres://u:pw@${encoded}/x`);
      const asQuery = assess(`postgres://u:pw@db.example.com/x?host=${encoded}`);
      expect(asHost.allowed, host).toBe(false);
      expect(asQuery.allowed, `?host=${host}`).toBe(false);
      expect(asHost.host, host).toBeNull();
      expect(asQuery.host, `?host=${host}`).toBeNull();
      expect(asHost.message, host).toContain("could not be parsed");
      expect(asHost.message, host).not.toContain("pw");
      expect(asQuery.message, `?host=${host}`).not.toContain("pw");
      expect(assess(`postgres://u:pw@${encoded}/x`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed, host).toBe(false);
      expect(
        assess(`postgres://u:pw@db.example.com/x?host=${encoded}`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed,
        `?host=${host}`,
      ).toBe(false);
    }
    expect(assess("postgres://user:pw@127.0.0.1./app").allowed).toBe(true);
    expect(assess("postgres://user:pw@localhost./app").allowed).toBe(true);
    expect(assess("postgres://user:pw@db.example.com/app?host=127.0.0.1.").host).toBe("127.0.0.1");
    expect(assess("postgres://user:pw@db.example.com/app?host=localhost.").host).toBe("localhost");
  });

  it("refuses a non-ASCII host that also contains a control character", () => {
    const host = `\uFF4Cocal\thost`;
    const encoded = encodeURIComponent(host);
    const asHost = assess(`postgres://u:pw@${encoded}/x`);
    const asQuery = assess(`postgres://u:pw@db.example.com/x?host=${encoded}`);
    expect(asHost.allowed).toBe(false);
    expect(asQuery.allowed).toBe(false);
    expect(asHost.host).toBeNull();
    expect(asQuery.host).toBeNull();
    expect(asHost.message).toContain("could not be parsed");
    expect(asHost.message).not.toContain("pw");
    expect(asQuery.message).not.toContain("pw");
    expect(assess(`postgres://u:pw@${encoded}/x`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(false);
    expect(
      assess(`postgres://u:pw@db.example.com/x?host=${encoded}`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed,
    ).toBe(false);
  });

  it("refuses a host pg would look up with surrounding whitespace", () => {
    for (const host of ["127.0.0.1\t", " localhost"]) {
      const encoded = encodeURIComponent(host);
      const asHost = assess(`postgres://u:pw@${encoded}/x`);
      const asQuery = assess(`postgres://u:pw@db.example.com/x?host=${encoded}`);
      expect(asHost.allowed, JSON.stringify(host)).toBe(false);
      expect(asQuery.allowed, `?host=${JSON.stringify(host)}`).toBe(false);
      expect(asHost.host, JSON.stringify(host)).toBeNull();
      expect(asQuery.host, `?host=${JSON.stringify(host)}`).toBeNull();
      expect(asHost.message, JSON.stringify(host)).not.toContain("pw");
      expect(asQuery.message, `?host=${JSON.stringify(host)}`).not.toContain("pw");
      expect(assess(`postgres://u:pw@${encoded}/x`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(false);
      expect(
        assess(`postgres://u:pw@db.example.com/x?host=${encoded}`, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed,
      ).toBe(false);
    }
    expect(assess(CI_URL).allowed).toBe(true);
    expect(assess("postgres://tharros:tharros@localhost:54329/tharros").allowed).toBe(true);
    expect(assess("postgres://tharros:tharros@[::1]:5432/tharros").allowed).toBe(true);
    expect(assess("postgres://user:pw@localhost/db?host=/var/run/postgresql").allowed).toBe(true);
    expect(assess("postgres://user:pw@localhost/db?host=127.0.0.1").allowed).toBe(true);
  });

  it("does not let a routing endpoint id use ci, test, or br- host labels", () => {
    const password = encodeURIComponent("endpoint=ep-other-branch$pw");
    const ci = `postgres://user:${password}@ci.example.com/app`;
    const testLabel = `postgres://user:pw@test.example.com/app?options=${encodeURIComponent("endpoint=ep-other-branch")}`;
    const branch = `postgres://user:${password}@br-cool-branch.us-east-2.aws.neon.tech/neondb`;
    expect(assess(ci).allowed).toBe(false);
    expect(assess(ci).message).not.toContain("pw");
    expect(assess(testLabel).allowed).toBe(false);
    expect(assess(branch).allowed).toBe(false);
    expect(assess(ci, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(true);
    expect(assess(branch, { ALLOW_NONLOCAL_TEST_DB: "1" }).allowed).toBe(true);
    expect(assess("postgres://user:pw@ci.example.com/app").allowed).toBe(true);
    expect(assess("postgres://user:pw@test.example.com/app").allowed).toBe(true);
    expect(assess("postgres://user:pw@br-cool-branch.us-east-2.aws.neon.tech/neondb").allowed).toBe(true);
    expect(assess(`postgres://user:${password}@127.0.0.1/app`).allowed).toBe(true);
  });

  it("does not copy PGOPTIONS or PGPASSWORD into the production endpoint set", () => {
    const prod = "ep-cool-darkness-123456.us-east-2.aws.neon.tech";
    const productionUrl = `postgres://owner:other-secret@${prod}/neondb`;
    const env = {
      PRODUCTION_DATABASE_URL: productionUrl,
      PGOPTIONS: "endpoint=ep-dev-branch",
    };
    expect(assess(CI_URL, env).allowed).toBe(true);
    expect(
      assess(`postgres://user:secret@${prod}/neondb`, { ...env, ALLOW_NONLOCAL_TEST_DB: "1" }).allowed,
    ).toBe(false);

    const dev = assess("postgres://user@ep-dev-branch.us-east-2.aws.neon.tech/neondb", {
      ...env,
      ALLOW_NONLOCAL_TEST_DB: "1",
    });
    expect(dev.allowed).toBe(true);
    expect(dev.message).not.toContain("production Neon");
    expect(dev.message).not.toContain("other-secret");

    const fromPassword = assess("postgres://user@1.2.3.4/neondb", {
      ALLOW_NONLOCAL_TEST_DB: "1",
      PRODUCTION_DATABASE_URL: `postgres://owner@${prod}/neondb`,
      PGPASSWORD: "endpoint=ep-dev-branch$super-secret",
    });
    expect(fromPassword.allowed).toBe(true);
    expect(fromPassword.message).not.toContain("production Neon");
    expect(fromPassword.message).not.toContain("super-secret");

    expect(
      assess(CI_URL, {
        PRODUCTION_NEON_HOST: productionUrl,
        PGOPTIONS: "endpoint=ep-dev-branch",
      }).allowed,
    ).toBe(true);
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
