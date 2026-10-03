import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertProdTarget,
  parseProdMigrateArgs,
  ProdMigrateError,
  redactDatabaseUrl,
  runOsProdMigrate,
} from "@tharros/ads-shared/prod-migrate";
import { assertSafeTestDatabase } from "@tharros/ads-shared/test-database";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const artifactsDir = resolve(repoRoot, "artifacts");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const cli = resolve(repoRoot, "apps/ads/shared/src/prod-migrate-cli.ts");
const createdDatabases: string[] = [];
const host = "127.0.0.1";

type BundleMigration = { tag: string; when: number; sha256: string; filename: string; idx: number };
type JournalEntry = { tag: string; when: number; idx: number };

const journal = JSON.parse(readFileSync(join(artifactsDir, "os-migrate-bundle.json"), "utf8")) as {
  migrations: BundleMigration[];
};
const drizzleJournal = JSON.parse(
  readFileSync(join(repoRoot, "apps/ads/shared/drizzle/meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

if (journal.migrations.length === 0) {
  throw new Error("artifacts/os-migrate-bundle.json has no migrations");
}
const pending = journal.migrations[journal.migrations.length - 1]!;
const appliedTags = journal.migrations.slice(0, -1).map((migration) => migration.tag);

function bundleMatchesJournal(): boolean {
  if (journal.migrations.length !== drizzleJournal.entries.length) return false;
  return journal.migrations.every((migration, index) => {
    const entry = drizzleJournal.entries[index];
    return entry?.tag === migration.tag && entry.when === migration.when && entry.idx === migration.idx;
  });
}

function assertLocalDatabase(databaseUrl: string): void {
  assertSafeTestDatabase({
    databaseUrl,
    env: process.env,
    purpose: "prod migrate tests",
    write: (message) => {
      throw new Error(message);
    },
    exit: () => {
      throw new Error("refusing test database");
    },
  });
}

function databaseUrlFor(database: string): string {
  const raw = process.env.DATABASE_URL ?? "";
  assertLocalDatabase(raw);
  const scheme = raw.startsWith("postgresql:") ? "postgresql:" : "postgres:";
  const url = new URL(raw.replace(/^postgres(ql)?:/, "http:"));
  const auth = url.username ? `${url.username}:${url.password}@` : "";
  const port = url.port ? `:${url.port}` : "";
  const next = `${scheme}//${auth}${url.hostname}${port}/${database}`;
  assertLocalDatabase(next);
  return next;
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL ?? "";
  assertLocalDatabase(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(name: string, template?: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("unsafe database name");
  if (template && !/^[a-z0-9_]+$/.test(template)) throw new Error("unsafe template name");
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    if (template) {
      await client.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    } else {
      await client.query(`CREATE DATABASE "${name}"`);
    }
  });
  createdDatabases.push(name);
  return databaseUrlFor(name);
}

function artifactSql(tag: string): string {
  return readFileSync(join(artifactsDir, `${tag}.sql`), "utf8");
}

function fileHash(tag: string): string {
  return createHash("sha256").update(artifactSql(tag)).digest("hex");
}

async function applyTags(client: pg.Client, tags: string[]): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS "os"');
  await client.query("SET search_path TO os, public");
  for (const tag of tags) {
    for (const statement of artifactSql(tag).split("--> statement-breakpoint")) {
      if (!statement.trim()) continue;
      await client.query(statement);
    }
  }
  await client.query(`CREATE TABLE IF NOT EXISTS "os"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  for (const tag of tags) {
    const entry = journal.migrations.find((migration) => migration.tag === tag);
    if (!entry) throw new Error(`missing ${tag}`);
    expect(fileHash(tag)).toBe(entry.sha256);
    await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
      entry.sha256,
      entry.when,
    ]);
  }
}

async function ledgerCount(databaseUrl: string): Promise<number> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`SELECT count(*)::int AS n FROM "os"."__drizzle_migrations"`);
    return Number(result.rows[0]?.n);
  } finally {
    await client.end();
  }
}

function pendingTableName(): string {
  const match = artifactSql(pending.tag).match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"os"\."([A-Za-z0-9_]+)"/i);
  if (!match?.[1]) throw new Error(`pending tag ${pending.tag} creates no os table`);
  return match[1];
}

async function pendingTable(databaseUrl: string): Promise<string | null> {
  const name = pendingTableName();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`SELECT to_regclass($1) AS rel`, [`os.${name}`]);
    const rel = result.rows[0]?.rel;
    return rel ? String(rel) : null;
  } finally {
    await client.end();
  }
}

const baseName = `cerevex_prod_mig_${process.pid}_base`;
let baseReady: Promise<string> | undefined;

function baseDatabase(): Promise<string> {
  baseReady ??= (async () => {
    const databaseUrl = await createDatabase(baseName);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await applyTags(client, appliedTags);
    } finally {
      await client.end();
    }
    return databaseUrl;
  })();
  return baseReady;
}

async function cloneBase(suffix: string): Promise<string> {
  await baseDatabase();
  return createDatabase(`cerevex_prod_mig_${process.pid}_${suffix}`, baseName);
}

function slowedArtifactDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "os-prod-race-"));
  const bundle = JSON.parse(readFileSync(join(artifactsDir, "os-migrate-bundle.json"), "utf8")) as {
    migrations: Array<{ filename: string; tag: string; sql: string; sha256: string }>;
  };
  for (const migration of bundle.migrations) {
    const original = readFileSync(join(artifactsDir, migration.filename), "utf8");
    const sql =
      migration.tag === pending.tag
        ? `SELECT pg_sleep(0.8);\n--> statement-breakpoint\n${original}`
        : original;
    writeFileSync(join(dir, migration.filename), sql);
    if (migration.tag === pending.tag) {
      migration.sql = sql;
      migration.sha256 = createHash("sha256").update(sql).digest("hex");
    }
  }
  writeFileSync(join(dir, "os-migrate-bundle.json"), JSON.stringify(bundle));
  return dir;
}

function request(databaseUrl: string, mode: "dry-run" | "apply" | "unconfirmed") {
  return runOsProdMigrate({
    databaseUrl,
    productionNeonHost: host,
    host,
    mode,
  });
}

afterAll(async () => {
  if (createdDatabases.length === 0) return;
  await withAdmin(async (client) => {
    for (const name of [...createdDatabases].reverse()) {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
});

describe("os production migrate", () => {
  beforeAll(async () => {
    await baseDatabase();
  }, 60_000);

  it("documents exactly one production command", () => {
    const readme = readFileSync(join(repoRoot, "apps/ads/README.md"), "utf8");
    const command = "npm run ads:db:migrate:prod -- --host <neon-host> --confirm";
    expect(readme.split(command)).toHaveLength(2);
    expect(readme).not.toContain("does not contain a production migrate command");
    const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(root.scripts["ads:db:migrate:prod"]).toBe("npm run migrate:prod --workspace=@tharros/ads-shared --");
  });

  it("derives the pending tag from the bundle and the journal", () => {
    expect(bundleMatchesJournal()).toBe(true);
    expect(pending.tag).toBe(drizzleJournal.entries[drizzleJournal.entries.length - 1]?.tag);
    expect(appliedTags).toEqual(drizzleJournal.entries.slice(0, -1).map((entry) => entry.tag));
  });

  it("refuses when PRODUCTION_NEON_HOST does not match the target", () => {
    expect(() =>
      assertProdTarget({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:5432/tharros",
        productionNeonHost: "ep-prod.region.aws.neon.tech",
        host: "127.0.0.1",
      }),
    ).toThrow(/PRODUCTION_NEON_HOST does not match the target/);
    expect(() =>
      assertProdTarget({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:5432/tharros",
        productionNeonHost: "ep-prod.region.aws.neon.tech",
        host: "ep-prod.region.aws.neon.tech",
      }),
    ).toThrow(/DATABASE_URL host does not match --host/);
  });

  it("refuses a sibling artifact whose hash does not match the bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "os-prod-migrate-"));
    const bundle = JSON.parse(readFileSync(join(artifactsDir, "os-migrate-bundle.json"), "utf8")) as {
      migrations: Array<{ filename: string; tag: string; sql: string }>;
    };
    for (const migration of bundle.migrations) {
      writeFileSync(join(dir, migration.filename), readFileSync(join(artifactsDir, migration.filename)));
    }
    const last = bundle.migrations[bundle.migrations.length - 1]!;
    writeFileSync(join(dir, last.filename), `${readFileSync(join(dir, last.filename), "utf8")}\n-- tamper\n`);
    writeFileSync(join(dir, "os-migrate-bundle.json"), JSON.stringify(bundle));
    await expect(
      runOsProdMigrate({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:1/cerevex_prod_mig_absent",
        productionNeonHost: host,
        host,
        mode: "dry-run",
        artifactsDir: dir,
      }),
    ).rejects.toThrow(new RegExp(`Artifact hash for ${last.tag} does not match the bundle`));
  });

  it("refuses to write without --confirm", async () => {
    const databaseUrl = await cloneBase("confirm");
    const before = await ledgerCount(databaseUrl);
    const error = await request(databaseUrl, "unconfirmed").then(
      () => {
        throw new Error("expected refusal");
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProdMigrateError);
    expect((error as Error).message).toContain("Pass --confirm");
    expect((error as ProdMigrateError).plan?.pending).toEqual([pending.tag]);
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("dry-run lists the pending tag and writes nothing", async () => {
    const databaseUrl = await cloneBase("dry");
    const before = await ledgerCount(databaseUrl);
    const report = await request(databaseUrl, "dry-run");
    expect(report.pending).toEqual([pending.tag]);
    expect(report.migrationsApplied).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("refuses ledger drift from an unknown row", async () => {
    const databaseUrl = await cloneBase("drift");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        "ab".repeat(32),
        1,
      ]);
    } finally {
      await client.end();
    }
    const before = await ledgerCount(databaseUrl);
    await expect(request(databaseUrl, "apply")).rejects.toThrow(/is not in the bundled artifacts/);
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("refuses a ledger hash that does not match the bundled artifact", async () => {
    const databaseUrl = await cloneBase("hash");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        "ff".repeat(32),
        pending.when,
      ]);
    } finally {
      await client.end();
    }
    await expect(request(databaseUrl, "apply")).rejects.toThrow(
      new RegExp(`Ledger hash for ${pending.tag} .* does not match the bundled artifact`),
    );
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("applies a pending migration once and is a no-op when it is already applied", async () => {
    const databaseUrl = await cloneBase("apply");
    const first = await request(databaseUrl, "apply");
    expect(first.migrationsApplied).toEqual([pending.tag]);
    expect(await pendingTable(databaseUrl)).toContain(pendingTableName());
    expect(await ledgerCount(databaseUrl)).toBe(journal.migrations.length);

    const second = await request(databaseUrl, "apply");
    expect(second.pending).toEqual([]);
    expect(second.migrationsApplied).toEqual([]);
    expect(await ledgerCount(databaseUrl)).toBe(journal.migrations.length);
  });

  it("the CLI refuses when DATABASE_URL is missing", async () => {
    const env = { ...process.env };
    delete env.PRODUCTION_NEON_HOST;
    delete env.DATABASE_URL;
    const result = await new Promise<{ code: number; stdout: string }>((resolvePromise, reject) => {
      const child = spawn(tsxBin, [cli, "--host", host, "--confirm"], {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("prod migrate cli timed out"));
      }, 20_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolvePromise({ code: code ?? 1, stdout });
      });
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("DATABASE_URL is required");
    expect(result.stdout).not.toContain("postgres://");
  });

  it("the CLI refuses when PRODUCTION_NEON_HOST is missing", async () => {
    const databaseUrl = "postgres://user:super-secret@127.0.0.1:5432/tharros";
    const result = await runCli(["--host", host, "--dry-run"], {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PRODUCTION_NEON_HOST: undefined,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Set PRODUCTION_NEON_HOST");
    expect(result.stdout).not.toContain("super-secret");
  });

  it("requires --host and does not default it", () => {
    expect(() => parseProdMigrateArgs(["--confirm"])).toThrow(/Name the prod host with --host/);
    expect(() => parseProdMigrateArgs(["--host"])).toThrow(/Name the prod host with --host/);
    expect(() => parseProdMigrateArgs(["--host", "--confirm"])).toThrow(/Name the prod host with --host/);
    expect(parseProdMigrateArgs(["--host", "ep-prod.example", "--dry-run"])).toEqual({
      host: "ep-prod.example",
      mode: "dry-run",
    });
  });

  it("redacts database URLs from error text", () => {
    const databaseUrl = "postgres://user:super-secret@ep-prod.example/neondb";
    const redacted = redactDatabaseUrl(`connect failed ${databaseUrl} and postgres://other:pw@host/db`, databaseUrl);
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("postgres://");
    expect(redacted).not.toContain("ep-prod.example");
    expect(redacted).toContain("[redacted-url]");
  });

  it("lists the ledger in a read-only transaction", () => {
    const source = readFileSync(join(repoRoot, "apps/ads/shared/src/prod-migrate.ts"), "utf8");
    expect(source).toContain("BEGIN READ ONLY");
    expect(source).toContain("transaction_read_only");
  });

  it("refuses a duplicate ledger row for one tag", async () => {
    const databaseUrl = await cloneBase("dup");
    const first = journal.migrations[0]!;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        first.sha256,
        first.when,
      ]);
    } finally {
      await client.end();
    }
    const before = await ledgerCount(databaseUrl);
    await expect(request(databaseUrl, "apply")).rejects.toThrow(
      new RegExp(`${first.tag} is recorded 2 times`),
    );
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("refuses a gap when a later tag is applied and an earlier tag is missing", async () => {
    const databaseUrl = await cloneBase("gap");
    const skipped = journal.migrations[2]!;
    const later = journal.migrations[3]!;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`DELETE FROM "os"."__drizzle_migrations" WHERE created_at = $1`, [skipped.when]);
    } finally {
      await client.end();
    }
    await expect(request(databaseUrl, "apply")).rejects.toThrow(
      new RegExp(`${later.tag} is applied but earlier bundled migration ${skipped.tag} is not`),
    );
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("refuses a known hash recorded at the wrong created_at", async () => {
    const databaseUrl = await cloneBase("when");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        pending.sha256,
        42,
      ]);
    } finally {
      await client.end();
    }
    await expect(request(databaseUrl, "apply")).rejects.toThrow(
      new RegExp(`hash of ${pending.tag} is recorded at created_at 42`),
    );
    expect(await pendingTable(databaseUrl)).toBeNull();
  });

  it("two overlapping confirms leave exactly one ledger row per tag", async () => {
    const databaseUrl = await cloneBase("race");
    const dir = slowedArtifactDir();
    const run = () =>
      runOsProdMigrate({
        databaseUrl,
        productionNeonHost: host,
        host,
        mode: "apply",
        artifactsDir: dir,
      });
    const results = await Promise.allSettled([run(), run()]);
    let applied = 0;
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ProdMigrateError);
        continue;
      }
      if (result.value.migrationsApplied.includes(pending.tag)) applied += 1;
      expect(result.value.migrationsApplied.filter((tag) => tag !== pending.tag)).toEqual([]);
    }
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const grouped = await client.query(
        `SELECT hash, created_at, count(*)::int AS n FROM "os"."__drizzle_migrations" GROUP BY hash, created_at`,
      );
      expect(grouped.rows).toHaveLength(journal.migrations.length);
      for (const row of grouped.rows) expect(Number(row.n)).toBe(1);
    } finally {
      await client.end();
    }
    expect(applied).toBe(1);
    expect(await pendingTable(databaseUrl)).toContain(pendingTableName());
  }, 30_000);

  it("refuses host, hostaddr, options, multiple hosts, sockets, endpoint passwords, and weak ssl", () => {
    const named = "ep-prod.region.aws.neon.tech";
    const base = `postgres://user:secret@${named}/neondb`;
    const target = { productionNeonHost: named, host: named };
    expect(() => assertProdTarget({ ...target, databaseUrl: `${base}?host=127.0.0.1&sslmode=require` })).toThrow(
      /must not set the host query parameter/,
    );
    expect(() => assertProdTarget({ ...target, databaseUrl: `${base}?hostaddr=10.0.0.5&sslmode=require` })).toThrow(
      /must not set hostaddr/,
    );
    expect(() =>
      assertProdTarget({
        ...target,
        databaseUrl: `${base}?options=-c%20endpoint%3Dep-other&sslmode=require`,
      }),
    ).toThrow(/must not set options/);
    expect(() =>
      assertProdTarget({
        ...target,
        databaseUrl: `postgres://user:secret@${named},ep-other.region.aws.neon.tech/neondb?sslmode=require`,
      }),
    ).toThrow(/exactly one host/);
    expect(() =>
      assertProdTarget({
        ...target,
        databaseUrl: "postgres://user:secret@%2Fvar%2Frun%2Fpostgresql/neondb?sslmode=require",
      }),
    ).toThrow(/unix socket/);
    expect(() =>
      assertProdTarget({
        ...target,
        databaseUrl: `postgres://user:endpoint=ep-other;secret@${named}/neondb?sslmode=require`,
      }),
    ).toThrow(/password must not contain endpoint=/);
    expect(() => assertProdTarget({ ...target, databaseUrl: `${base}?sslmode=disable` })).toThrow(
      /sslmode=disable is not allowed/,
    );
    expect(() => assertProdTarget({ ...target, databaseUrl: base })).toThrow(/sslmode=require or stricter/);
    expect(() => assertProdTarget({ ...target, databaseUrl: `${base}?sslmode=prefer` })).toThrow(
      /sslmode=require or stricter/,
    );
    expect(assertProdTarget({ ...target, databaseUrl: `${base}?sslmode=require` })).toBe(named);
    expect(assertProdTarget({ ...target, databaseUrl: `${base}?sslmode=verify-full` })).toBe(named);
  });

  it("refuses bundled SQL that targets the public schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "os-prod-public-"));
    const sql = 'CREATE TABLE "public"."leak" (\n\t"id" uuid PRIMARY KEY\n);\n';
    const digest = createHash("sha256").update(sql).digest("hex");
    writeFileSync(join(dir, "0000_leak.sql"), sql);
    writeFileSync(
      join(dir, "os-migrate-bundle.json"),
      JSON.stringify({
        migrations: [{ filename: "0000_leak.sql", tag: "0000_leak", idx: 0, when: 1, sha256: digest, sql }],
      }),
    );
    await expect(
      runOsProdMigrate({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:1/cerevex_prod_mig_absent",
        productionNeonHost: host,
        host,
        mode: "dry-run",
        artifactsDir: dir,
      }),
    ).rejects.toThrow(/0000_leak targets the public schema/);
  });
});

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string }> {
  const childEnv = { ...env };
  if (childEnv.PRODUCTION_NEON_HOST === undefined) delete childEnv.PRODUCTION_NEON_HOST;
  if (childEnv.DATABASE_URL === undefined) delete childEnv.DATABASE_URL;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(tsxBin, [cli, ...args], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("prod migrate cli timed out"));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout });
    });
  });
}
