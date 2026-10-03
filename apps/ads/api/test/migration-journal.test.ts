import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  LEGACY_LEDGER_COPY_SQL,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  migrationsRelation,
} from "@tharros/ads-shared/migration-ledger";
import {
  assertMigrationJournal,
  assertMigrationsApplied,
  assertNoSkippedBeforeMigrate,
  assertPopulatedSchemaHasLedger,
  migrationSqlHash,
  MigrationJournalError,
} from "@tharros/ads-shared/migration-journal";
import { assertSafeTestDatabase } from "@tharros/ads-shared/test-database";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const realMigrations = resolve(here, "../../shared/drizzle");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const migrateScript = resolve(here, "../../shared/src/migrate.ts");
const ledgerScript = resolve(here, "../../shared/src/query-migration-ledger.ts");
const journalCheckScript = resolve(here, "../../shared/scripts/check-migration-journal.mjs");
const createdDatabases: string[] = [];

function assertLocalDatabase(databaseUrl: string): void {
  assertSafeTestDatabase({
    databaseUrl,
    env: process.env,
    purpose: "migration journal tests",
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
  url.protocol = "http:";
  url.pathname = `/${database}`;
  const next = url.toString().replace(/^http:/, scheme);
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

async function createDatabase(name: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("unsafe database name");
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
  createdDatabases.push(name);
  return databaseUrlFor(name);
}

function runNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = repoRoot,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("migrate timed out"));
    }, 25_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runMigrate(env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return runNode([tsxBin, migrateScript], env);
}

/** Fixture copies stop at 0005 so a later tag such as 0006 is not part of the skip case. */
function copyMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), "cerevex-journal-"));
  cpSync(realMigrations, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string; idx: number }>;
  };
  const limit = journal.entries.find((entry) => entry.tag === "0005_skill_config");
  if (!limit) throw new Error("0005_skill_config missing from the journal fixture");
  const removed = journal.entries.filter((entry) => entry.idx > limit.idx);
  journal.entries = journal.entries.filter((entry) => entry.idx <= limit.idx);
  writeFileSync(journalPath, JSON.stringify(journal));
  for (const entry of removed) rmSync(join(dir, `${entry.tag}.sql`), { force: true });
  return dir;
}

afterAll(async () => {
  if (createdDatabases.length === 0) return;
  await withAdmin(async (client) => {
    for (const name of createdDatabases) {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
});

describe("migration journal", () => {
  it("accepts the real journal", () => {
    const entries = assertMigrationJournal(realMigrations);
    const tags = entries.map((entry) => entry.tag);
    const prefix = [
      "0000_m1_spine",
      "0001_m2_connect",
      "0002_m5_apply",
      "0003_m51",
      "0004_site_clients",
      "0005_skill_config",
      "0006_plan_entitlements",
    ];
    expect(tags.slice(0, prefix.length)).toEqual(prefix);
    expect(tags).toContain("0006_plan_entitlements");
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index]!.idx).toBeGreaterThan(entries[index - 1]!.idx);
      expect(entries[index]!.when).toBeGreaterThan(entries[index - 1]!.when);
    }
  });

  it("fails the pre-check for a tampered journal and migrate exits non-zero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cerevex-journal-bad-"));
    mkdirSync(join(dir, "meta"), { recursive: true });
    writeFileSync(join(dir, "0000_a.sql"), "select 1;\n");
    writeFileSync(join(dir, "0001_b.sql"), "select 2;\n");
    writeFileSync(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 20, tag: "0000_a", breakpoints: true },
          { idx: 1, version: "7", when: 10, tag: "0001_b", breakpoints: true },
        ],
      }),
    );
    expect(() => assertMigrationJournal(dir)).toThrow(MigrationJournalError);
    expect(() => assertMigrationJournal(dir)).toThrow(/0001_b/);

    const reversedIdx = mkdtempSync(join(tmpdir(), "cerevex-journal-idx-"));
    mkdirSync(join(reversedIdx, "meta"), { recursive: true });
    writeFileSync(join(reversedIdx, "0000_a.sql"), "select 1;\n");
    writeFileSync(join(reversedIdx, "0001_b.sql"), "select 2;\n");
    writeFileSync(
      join(reversedIdx, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 1, version: "7", when: 10, tag: "0000_a", breakpoints: true },
          { idx: 0, version: "7", when: 20, tag: "0001_b", breakpoints: true },
        ],
      }),
    );
    expect(() => assertMigrationJournal(reversedIdx)).toThrow(/idx must increase/);

    const extra = copyMigrations();
    writeFileSync(join(extra, "0009_extra.sql"), "select 1;\n");
    expect(() => assertMigrationJournal(extra)).toThrow(
      /0009_extra.sql is not in the journal\. Rollback SQL belongs in apps\/ads\/shared\/drizzle-rollbacks\//,
    );

    const result = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      ADS_MIGRATIONS_FOLDER: dir,
      DATABASE_URL: process.env.DATABASE_URL,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("0001_b");
    expect(result.stderr).toContain("when must increase");
    rmSync(dir, { recursive: true, force: true });
    rmSync(reversedIdx, { recursive: true, force: true });
    rmSync(extra, { recursive: true, force: true });
  });

  it("applies every journal entry on a fresh local database", async () => {
    const databaseUrl = await createDatabase(`cerevex_migrate_test_${process.pid}_fresh`);
    const result = await runMigrate({
      ...process.env,
      DATABASE_URL: databaseUrl,
    });
    expect(result.code, result.stderr).toBe(0);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const rows = await client.query<{ hash: string }>(`select hash from ${migrationsRelation()}`);
      expect(rows.rows).toHaveLength(assertMigrationJournal(realMigrations).length);
      const table = await client.query(`select to_regclass('os.skill_client_configs') as name`);
      expect(table.rows[0]?.name).toBe("skill_client_configs");
    } finally {
      await client.end();
    }
  }, 60_000);

  it("exits non-zero when a migration is stamped below the last applied one", async () => {
    const folder = copyMigrations();
    const journalPath = join(folder, "meta", "_journal.json");
    const original = readFileSync(journalPath, "utf8");
    const journal = JSON.parse(original) as { entries: Array<{ tag: string; idx: number; when: number }> };
    const skipped = journal.entries.find((entry) => entry.tag === "0004_site_clients");
    expect(skipped).toBeTruthy();
    journal.entries = journal.entries.filter((entry) => entry.tag !== "0004_site_clients");
    writeFileSync(journalPath, JSON.stringify(journal));
    rmSync(join(folder, "0004_site_clients.sql"));

    const databaseUrl = await createDatabase(`cerevex_migrate_test_${process.pid}_skip`);
    const first = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    });
    expect(first.code, first.stderr).toBe(0);

    writeFileSync(journalPath, original);
    cpSync(join(realMigrations, "0004_site_clients.sql"), join(folder, "0004_site_clients.sql"));
    const second = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    });
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("0004_site_clients");
    expect(second.stderr).toContain(`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`);
    expect(second.stderr).toContain("Refusing to migrate");
    rmSync(folder, { recursive: true, force: true });
  }, 60_000);

  it("refuses a gap before Drizzle can commit a newer migration", async () => {
    const folder = copyMigrations();
    const journalPath = join(folder, "meta", "_journal.json");
    const original = readFileSync(journalPath, "utf8");
    const journal = JSON.parse(original) as { entries: Array<{ tag: string; idx: number; when: number }> };
    journal.entries = journal.entries.filter((entry) => entry.tag !== "0004_site_clients");
    writeFileSync(journalPath, JSON.stringify(journal));
    rmSync(join(folder, "0004_site_clients.sql"));

    const databaseUrl = await createDatabase(`cerevex_migrate_test_${process.pid}_gap`);
    const first = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    });
    expect(first.code, first.stderr).toBe(0);

    const restored = JSON.parse(original) as {
      entries: Array<{ tag: string; idx: number; when: number; version?: string; breakpoints?: boolean }>;
    };
    const maxWhen = Math.max(...restored.entries.map((entry) => entry.when));
    const maxIdx = Math.max(...restored.entries.map((entry) => entry.idx));
    restored.entries.push({
      idx: maxIdx + 1,
      version: "7",
      when: maxWhen + 1_000_000,
      tag: "0006_probe",
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(restored));
    cpSync(join(realMigrations, "0004_site_clients.sql"), join(folder, "0004_site_clients.sql"));
    writeFileSync(join(folder, "0006_probe.sql"), "CREATE TABLE IF NOT EXISTS os.migrate_guard_probe (id integer);\n");

    const second = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    });
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("Refusing to migrate");
    expect(second.stderr).toContain("0004_site_clients");
    expect(second.stdout).not.toContain("Applied OS migrations");

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const probe = await client.query(`select to_regclass('os.migrate_guard_probe') as name`);
      const pending = await client.query(`select to_regclass('os.oauth_pending_connections') as name`);
      expect(probe.rows[0]?.name).toBeNull();
      expect(pending.rows[0]?.name).toBeNull();
    } finally {
      await client.end();
    }
    rmSync(folder, { recursive: true, force: true });
  }, 60_000);

  it("prints both hashes and does not throw when a ledger hash is null", () => {
    const folder = copyMigrations();
    const entries = assertMigrationJournal(folder);
    const skipped = entries.find((entry) => entry.tag === "0004_site_clients");
    expect(skipped).toBeTruthy();
    const expected = migrationSqlHash(readFileSync(join(folder, "0004_site_clients.sql"), "utf8"));
    const applied = entries
      .filter((entry) => entry.tag !== "0004_site_clients")
      .map((entry) => ({
        hash: migrationSqlHash(readFileSync(join(folder, `${entry.tag}.sql`), "utf8")),
        createdAt: entry.when,
      }));
    expect(() => assertNoSkippedBeforeMigrate(folder, entries, applied)).toThrow(
      new RegExp(`Expected hash ${expected}\\. Found hash <none>`),
    );

    const mismatched = [
      ...applied,
      { hash: "abc123", createdAt: skipped!.when },
    ];
    expect(() => assertMigrationsApplied(folder, entries, mismatched)).toThrow(
      new RegExp(`Expected hash ${expected}\\. Found hash abc123`),
    );
    expect(() => assertMigrationsApplied(folder, entries, [{ hash: null, createdAt: 1 }])).toThrow(/<null>/);
    rmSync(folder, { recursive: true, force: true });
  });

  it("ignores ADS_MIGRATIONS_FOLDER unless NODE_ENV is test", async () => {
    const folder = join(tmpdir(), "cerevex-foreign-migrations-missing");
    for (const nodeEnv of ["production", undefined]) {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ADS_MIGRATIONS_FOLDER: folder,
        DATABASE_URL: "postgres://user:pw@127.0.0.1:1/nope",
      };
      if (nodeEnv) env.NODE_ENV = nodeEnv;
      else delete env.NODE_ENV;
      const result = await runMigrate(env);
      expect(result.code, nodeEnv ?? "unset").not.toBe(0);
      expect(result.stderr, nodeEnv ?? "unset").toContain("ADS_MIGRATIONS_FOLDER is honored only when NODE_ENV=test");
      expect(result.stderr, nodeEnv ?? "unset").toContain("Refusing to read a foreign migrations folder");
      expect(result.stderr, nodeEnv ?? "unset").not.toContain("could not be read");
      expect(result.stderr, nodeEnv ?? "unset").not.toContain("ECONNREFUSED");
    }
  });

  it("lists the ledger without writing and fails when the ledger is missing", async () => {
    const databaseUrl = await createDatabase(`cerevex_migrate_test_${process.pid}_ledger`);
    const missing = await runNode([tsxBin, ledgerScript], {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    });
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain(`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} does not exist`);

    const migrated = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    });
    expect(migrated.code, migrated.stderr).toBe(0);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const before = await client.query(`select count(*)::int as n from ${migrationsRelation()}`);
      const listed = await runNode([tsxBin, ledgerScript], {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
      });
      expect(listed.code, listed.stderr).toBe(0);
      expect(listed.stdout).toContain(`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} rows: ${before.rows[0]?.n}`);
      const after = await client.query(`select count(*)::int as n from ${migrationsRelation()}`);
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    } finally {
      await client.end();
    }
  }, 60_000);

  it("forces LF for drizzle SQL and fails CI when main's tags change", async () => {
    const attributes = readFileSync(resolve(repoRoot, ".gitattributes"), "utf8");
    expect(attributes).toContain("apps/ads/shared/drizzle/*.sql text eol=lf");
    const sql = readFileSync(join(realMigrations, "0004_site_clients.sql"));
    expect(sql.includes(13)).toBe(false);

    const root = mkdtempSync(join(tmpdir(), "cerevex-journal-git-"));
    const gitEnv = { ...process.env };
    delete gitEnv.GIT_DIR;
    delete gitEnv.GIT_WORK_TREE;
    delete gitEnv.GIT_INDEX_FILE;
    gitEnv.GIT_AUTHOR_NAME = "Cerevex Test";
    gitEnv.GIT_AUTHOR_EMAIL = "test@example.com";
    gitEnv.GIT_COMMITTER_NAME = "Cerevex Test";
    gitEnv.GIT_COMMITTER_EMAIL = "test@example.com";
    const git = (args: string[]) => execFileSync("git", args, { cwd: root, env: gitEnv });
    git(["init", "-b", "main"]);
    const drizzle = join(root, "apps/ads/shared/drizzle");
    mkdirSync(join(drizzle, "meta"), { recursive: true });
    const originalSql = "select 1;\n";
    writeFileSync(join(drizzle, "0000_base.sql"), originalSql);
    writeFileSync(
      join(drizzle, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 100, tag: "0000_base", breakpoints: true }],
      }),
    );
    git(["add", "."]);
    git(["commit", "-m", "base"]);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const check = (ci: boolean) => {
      const env: NodeJS.ProcessEnv = { ...gitEnv };
      if (ci) env.CI = "true";
      else delete env.CI;
      return runNode([journalCheckScript], env, root);
    };
    const ok = await check(true);
    expect(ok.code, ok.stderr).toBe(0);

    git(["update-ref", "-d", "refs/remotes/origin/main"]);
    const missingCi = await check(true);
    expect(missingCi.code).not.toBe(0);
    expect(missingCi.stderr).toContain("origin/main is missing");
    const missingLocal = await check(false);
    expect(missingLocal.code, missingLocal.stderr).toBe(0);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);

    writeFileSync(
      join(drizzle, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 50, tag: "0000_base", breakpoints: true }],
      }),
    );
    const changedWhen = await check(true);
    expect(changedWhen.code).not.toBe(0);
    expect(changedWhen.stderr).toContain("0000_base when 50 does not match origin/main (100)");

    writeFileSync(
      join(drizzle, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 100, tag: "0000_base", breakpoints: true }],
      }),
    );
    const editedSql = "select 2;\n";
    writeFileSync(join(drizzle, "0000_base.sql"), editedSql);
    const changedSql = await check(true);
    expect(changedSql.code).not.toBe(0);
    expect(changedSql.stderr).toContain(createHash("sha256").update(originalSql).digest("hex"));
    expect(changedSql.stderr).toContain(createHash("sha256").update(editedSql).digest("hex"));

    writeFileSync(join(drizzle, "0000_base.sql"), originalSql);
    writeFileSync(
      join(drizzle, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "postgresql", entries: [] }),
    );
    rmSync(join(drizzle, "0000_base.sql"));
    const removed = await check(true);
    expect(removed.code).not.toBe(0);
    expect(removed.stderr).toContain("0000_base is on origin/main but missing");
    rmSync(root, { recursive: true, force: true });
  }, 30_000);

  it("refuses a populated schema whose ledger is missing or empty", async () => {
    expect(LEGACY_LEDGER_COPY_SQL).toBe(
      `CREATE TABLE IF NOT EXISTS os.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO os.__drizzle_migrations (hash, created_at) SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;`,
    );
    expect(readFileSync(resolve(repoRoot, "apps/ads/README.md"), "utf8")).toContain(LEGACY_LEDGER_COPY_SQL);
    expect(() =>
      assertPopulatedSchemaHasLedger({ otherOsTables: 0, ledgerRows: null, legacyLedgerRows: 0 }),
    ).not.toThrow();
    expect(() =>
      assertPopulatedSchemaHasLedger({ otherOsTables: 1, ledgerRows: null, legacyLedgerRows: 0 }),
    ).toThrow(/schema os already has tables/);
    expect(() =>
      assertPopulatedSchemaHasLedger({ otherOsTables: 0, ledgerRows: 0, legacyLedgerRows: 2 }),
    ).toThrow(/drizzle\.__drizzle_migrations has rows/);

    const folder = mkdtempSync(join(tmpdir(), "cerevex-journal-populated-"));
    mkdirSync(join(folder, "meta"), { recursive: true });
    const markerSql = 'CREATE TABLE "os"."legacy_copy_marker" (id integer);\n';
    writeFileSync(join(folder, "0000_marker.sql"), markerSql);
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 100, tag: "0000_marker", breakpoints: true }],
      }),
    );
    const databaseUrl = await createDatabase(`cerevex_migrate_test_${process.pid}_pop`);
    const hash = migrationSqlHash(markerSql);
    const setup = new pg.Client({ connectionString: databaseUrl });
    await setup.connect();
    try {
      await setup.query(`CREATE SCHEMA ${MIGRATIONS_SCHEMA}`);
      await setup.query(markerSql);
      await setup.query(`CREATE SCHEMA drizzle`);
      await setup.query(
        `CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text, created_at bigint)`,
      );
      await setup.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [hash, 100]);
    } finally {
      await setup.end();
    }

    const env = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    };
    const missing = await runMigrate(env);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain("is missing");
    expect(missing.stderr).toContain("already has tables");
    expect(missing.stderr).toContain(LEGACY_LEDGER_COPY_SQL);
    expect(missing.stdout).not.toContain("Applied OS migrations");

    const midway = new pg.Client({ connectionString: databaseUrl });
    await midway.connect();
    try {
      const ledger = await midway.query(`select to_regclass('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}') as name`);
      expect(ledger.rows[0]?.name).toBeNull();
      await midway.query(
        `CREATE TABLE ${migrationsRelation()} (id serial primary key, hash text, created_at bigint)`,
      );
      const empty = await runMigrate(env);
      expect(empty.code).not.toBe(0);
      expect(empty.stderr).toContain("is empty");
      expect(empty.stderr).toContain(LEGACY_LEDGER_COPY_SQL);
      const rows = await midway.query(`select count(*)::int as n from ${migrationsRelation()}`);
      expect(rows.rows[0]?.n).toBe(0);
      await midway.query(`DROP TABLE ${migrationsRelation()}`);
      const dropped = await midway.query(`select to_regclass('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}') as name`);
      expect(dropped.rows[0]?.name).toBeNull();
      await midway.query(LEGACY_LEDGER_COPY_SQL);
    } finally {
      await midway.end();
    }

    const copied = await runMigrate(env);
    expect(copied.code, copied.stderr).toBe(0);
    const again = await runMigrate(env);
    expect(again.code, again.stderr).toBe(0);
    const after = new pg.Client({ connectionString: databaseUrl });
    await after.connect();
    try {
      const rows = await after.query(`select hash, created_at::text from ${migrationsRelation()}`);
      expect(rows.rows).toEqual([{ hash, created_at: "100" }]);
    } finally {
      await after.end();
    }
    rmSync(folder, { recursive: true, force: true });
  }, 60_000);

  it("exits non-zero when the ledger cannot be read", async () => {
    const database = `cerevex_migrate_test_${process.pid}_perm`;
    const databaseUrl = await createDatabase(database);
    const role = `cerevex_nosel_${process.pid}`;
    const password = "local_only_nosel";
    await withAdmin(async (client) => {
      await client.query(`DROP ROLE IF EXISTS "${role}"`);
      await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    });
    const owner = new pg.Client({ connectionString: databaseUrl });
    await owner.connect();
    try {
      await owner.query(`CREATE SCHEMA ${MIGRATIONS_SCHEMA}`);
      await owner.query(
        `CREATE TABLE ${migrationsRelation()} (id serial primary key, hash text, created_at bigint)`,
      );
      await owner.query(`REVOKE ALL ON SCHEMA ${MIGRATIONS_SCHEMA} FROM PUBLIC`);
      await owner.query(`REVOKE ALL ON TABLE ${migrationsRelation()} FROM PUBLIC`);
      await owner.query(`GRANT USAGE ON SCHEMA ${MIGRATIONS_SCHEMA} TO "${role}"`);
      await owner.query(`GRANT CONNECT, CREATE ON DATABASE "${database}" TO "${role}"`);
    } finally {
      await owner.end();
    }
    const raw = process.env.DATABASE_URL ?? "";
    const scheme = raw.startsWith("postgresql:") ? "postgresql:" : "postgres:";
    const url = new URL(raw.replace(/^postgres(ql)?:/, "http:"));
    url.protocol = "http:";
    url.username = role;
    url.password = password;
    url.pathname = `/${database}`;
    const roleUrl = url.toString().replace(/^http:/, scheme);
    assertLocalDatabase(roleUrl);
    try {
      const result = await runMigrate({
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: roleUrl,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("42501");
      expect(result.stderr).toContain(`Cannot read ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`);
      expect(result.stdout).not.toContain("Applied OS migrations");
    } finally {
      const cleanup = new pg.Client({ connectionString: databaseUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`REVOKE ALL ON SCHEMA ${MIGRATIONS_SCHEMA} FROM "${role}"`);
        await cleanup.query(`REVOKE ALL ON TABLE ${migrationsRelation()} FROM "${role}"`);
      } finally {
        await cleanup.end();
      }
      await withAdmin(async (client) => {
        await client.query(`REVOKE ALL ON DATABASE "${database}" FROM "${role}"`);
        await client.query(`DROP ROLE IF EXISTS "${role}"`);
      });
    }
  }, 60_000);

  it("fails the post-check when an applied row is not in the journal", async () => {
    const databaseUrl = await createDatabase(`cerevex_migrate_test_${process.pid}_post`);
    const first = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    });
    expect(first.code, first.stderr).toBe(0);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`insert into ${migrationsRelation()} (hash, created_at) values ($1, $2)`, [
        "a".repeat(64),
        9_999_999_999_999,
      ]);
    } finally {
      await client.end();
    }
    const second = await runMigrate({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    });
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("is not in the journal");
    expect(second.stdout).not.toContain("Applied OS migrations");
  }, 60_000);
});
