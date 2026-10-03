import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { assertMigrationJournal, MigrationJournalError } from "@tharros/ads-shared/migration-journal";
import { assertSafeTestDatabase } from "@tharros/ads-shared/test-database";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const realMigrations = resolve(here, "../../shared/drizzle");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const migrateScript = resolve(here, "../../shared/src/migrate.ts");
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

function runMigrate(env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tsxBin, migrateScript], {
      cwd: repoRoot,
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

function copyMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), "cerevex-journal-"));
  cpSync(realMigrations, dir, { recursive: true });
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
    expect(entries.map((entry) => entry.tag)).toEqual([
      "0000_m1_spine",
      "0001_m2_connect",
      "0002_m5_apply",
      "0003_m51",
      "0004_site_clients",
      "0005_skill_config",
    ]);
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
      const rows = await client.query<{ hash: string }>(`select hash from "os"."__drizzle_migrations"`);
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
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    });
    expect(first.code, first.stderr).toBe(0);

    writeFileSync(journalPath, original);
    cpSync(join(realMigrations, "0004_site_clients.sql"), join(folder, "0004_site_clients.sql"));
    const second = await runMigrate({
      ...process.env,
      DATABASE_URL: databaseUrl,
      ADS_MIGRATIONS_FOLDER: folder,
    });
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("0004_site_clients");
    expect(second.stderr).toContain("os.__drizzle_migrations");
    rmSync(folder, { recursive: true, force: true });
  }, 60_000);
});
