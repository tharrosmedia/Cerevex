import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, migrationsRelation } from "@tharros/ads-shared/migration-ledger";
import { assertSafeTestDatabase } from "@tharros/ads-shared/test-database";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const migrationsDir = resolve(here, "../../shared/drizzle");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const migrateScript = resolve(here, "../../shared/src/migrate.ts");
const createdDatabases: string[] = [];

type JournalEntry = { tag: string; when: number };

function assertLocalDatabase(databaseUrl: string): void {
  assertSafeTestDatabase({
    databaseUrl,
    env: process.env,
    purpose: "migration schema tests",
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

function journal(): JournalEntry[] {
  const parsed = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  return parsed.entries;
}

function fileHash(tag: string): string {
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`)).toString();
  return createHash("sha256").update(sql).digest("hex");
}

async function applySqlFiles(client: pg.Client, tags: string[]): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS "os"');
  await client.query("SET search_path TO os, public");
  for (const tag of tags) {
    const sql = readFileSync(join(migrationsDir, `${tag}.sql`)).toString();
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (!statement.trim()) continue;
      await client.query(statement);
    }
  }
}

function runMigrate(databaseUrl: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tsxBin, migrateScript], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
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

afterAll(async () => {
  if (createdDatabases.length === 0) return;
  await withAdmin(async (client) => {
    for (const name of createdDatabases) {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
});

describe("migration journal schema", () => {
  it("uses the os ledger", () => {
    expect(MIGRATIONS_SCHEMA).toBe("os");
    expect(MIGRATIONS_TABLE).toBe("__drizzle_migrations");
    expect(migrationsRelation()).toBe('"os"."__drizzle_migrations"');
  });

  it("applies only the missing migration on a prod-shaped ledger and does not create drizzle", async () => {
    const entries = journal();
    const prefix = [
      "0000_m1_spine",
      "0001_m2_connect",
      "0002_m5_apply",
      "0003_m51",
      "0004_site_clients",
      "0005_skill_config",
      "0006_plan_entitlements",
    ];
    expect(entries.map((entry) => entry.tag).slice(0, prefix.length)).toEqual(prefix);
    const applied = entries.slice(0, 6);
    const pending = entries.find((entry) => entry.tag === "0006_plan_entitlements");
    if (!pending) throw new Error("0006_plan_entitlements missing");
    const ids = [1, 2, 4, 5, 3, 6];
    expect(applied[4]!.tag).toBe("0004_site_clients");
    expect(applied[5]!.tag).toBe("0005_skill_config");
    expect(ids[4]).toBe(3);

    const databaseUrl = await createDatabase(`cerevex_schema_test_${process.pid}_prod`);
    const setup = new pg.Client({ connectionString: databaseUrl });
    await setup.connect();
    try {
      await applySqlFiles(
        setup,
        applied.map((entry) => entry.tag),
      );
      await setup.query(
        `CREATE TABLE ${migrationsRelation()} (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )`,
      );
      for (let index = 0; index < applied.length; index += 1) {
        const entry = applied[index]!;
        await setup.query(`INSERT INTO ${migrationsRelation()} (id, hash, created_at) VALUES ($1, $2, $3)`, [
          ids[index],
          fileHash(entry.tag),
          entry.when,
        ]);
      }
      await setup.query(`SELECT setval(pg_get_serial_sequence('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}', 'id'), $1)`, [
        Math.max(...ids),
      ]);
      const before = await setup.query(`select to_regclass('os.locations') as name`);
      expect(before.rows[0]?.name).toBeNull();
    } finally {
      await setup.end();
    }

    const first = await runMigrate(databaseUrl);
    expect(first.code, first.stderr).toBe(0);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const drizzleSchema = await client.query(`select nspname from pg_namespace where nspname = 'drizzle'`);
      expect(drizzleSchema.rows).toEqual([]);
      expect((await client.query(`select to_regclass('drizzle.__drizzle_migrations') as name`)).rows[0]?.name).toBeNull();
      const rows = await client.query<{ id: number; hash: string; created_at: string }>(
        `select id, hash, created_at::text from ${migrationsRelation()} order by created_at`,
      );
      expect(rows.rows).toHaveLength(7);
      const stamped = rows.rows.find((row) => Number(row.created_at) === pending.when);
      expect(stamped?.hash).toBe(fileHash(pending.tag));
      expect(rows.rows.find((row) => row.hash === fileHash("0004_site_clients"))?.id).toBe(3);
      expect((await client.query(`select to_regclass('os.skill_client_configs') as name`)).rows[0]?.name).toBe(
        "skill_client_configs",
      );
      expect((await client.query(`select to_regclass('os.locations') as name`)).rows[0]?.name).toBe("locations");
      const beforeSecond = rows.rows.map((row) => `${row.id}:${row.hash}:${row.created_at}`);
      const second = await runMigrate(databaseUrl);
      expect(second.code, second.stderr).toBe(0);
      const again = await client.query<{ id: number; hash: string; created_at: string }>(
        `select id, hash, created_at::text from ${migrationsRelation()} order by created_at`,
      );
      expect(again.rows.map((row) => `${row.id}:${row.hash}:${row.created_at}`)).toEqual(beforeSecond);
      expect((await client.query(`select nspname from pg_namespace where nspname = 'drizzle'`)).rows).toEqual([]);
    } finally {
      await client.end();
    }
  }, 60_000);

  it("applies every migration on a fresh database into os.__drizzle_migrations", async () => {
    const databaseUrl = await createDatabase(`cerevex_schema_test_${process.pid}_fresh`);
    const first = await runMigrate(databaseUrl);
    expect(first.code, first.stderr).toBe(0);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const rows = await client.query<{ created_at: string; hash: string }>(
        `select created_at::text, hash from ${migrationsRelation()} order by created_at`,
      );
      const entries = journal();
      expect(rows.rows.map((row) => Number(row.created_at))).toEqual(entries.map((entry) => entry.when));
      expect(rows.rows.map((row) => row.hash)).toEqual(entries.map((entry) => fileHash(entry.tag)));
      expect((await client.query(`select nspname from pg_namespace where nspname = 'drizzle'`)).rows).toEqual([]);
      expect((await client.query(`select to_regclass('os.skill_client_configs') as name`)).rows[0]?.name).toBe(
        "skill_client_configs",
      );
      const second = await runMigrate(databaseUrl);
      expect(second.code, second.stderr).toBe(0);
      const again = await client.query(`select count(*)::int as n from ${migrationsRelation()}`);
      expect(again.rows[0]?.n).toBe(entries.length);
    } finally {
      await client.end();
    }
  }, 60_000);
});
