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

  it("applies the migrations missing from a prod-shaped ledger and does not create drizzle", async () => {
    const entries = journal();
    const prefix = [
      "0000_m1_spine",
      "0001_m2_connect",
      "0002_m5_apply",
      "0003_m51",
      "0004_site_clients",
      "0005_skill_config",
      "0006_plan_entitlements",
      "0007_service_actor_constraints",
      "0008_client_audit_log",
    ];
    expect(entries.map((entry) => entry.tag)).toEqual(prefix);
    const applied = entries.slice(0, 6);
    const pending = entries.slice(6);
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
      expect(rows.rows).toHaveLength(applied.length + pending.length);
      for (const entry of pending) {
        const stamped = rows.rows.find((row) => Number(row.created_at) === entry.when);
        expect(stamped?.hash).toBe(fileHash(entry.tag));
      }
      expect((await client.query(`select to_regclass('os.client_audit_log') as name`)).rows[0]?.name).toBe(
        "client_audit_log",
      );
      expect(rows.rows.find((row) => row.hash === fileHash("0004_site_clients"))?.id).toBe(3);
      expect((await client.query(`select to_regclass('os.skill_client_configs') as name`)).rows[0]?.name).toBe(
        "skill_client_configs",
      );
      expect((await client.query(`select to_regclass('os.locations') as name`)).rows[0]?.name).toBe("locations");
      expect((await client.query(`select to_regclass('os.apply_jobs_authorization_uidx') as name`)).rows[0]?.name).toBe(
        "apply_jobs_authorization_uidx",
      );
      const plan = await client.query(
        `select column_name from information_schema.columns where table_schema = 'os' and table_name = 'clients' and column_name = 'plan'`,
      );
      expect(plan.rows).toHaveLength(1);
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

  it("applies 0008 on a database whose ledger already has 0000 through 0007", async () => {
    const entries = journal();
    const applied = entries.slice(0, 8);
    const pending = entries[8];
    expect(applied.map((entry) => entry.tag)).toEqual([
      "0000_m1_spine",
      "0001_m2_connect",
      "0002_m5_apply",
      "0003_m51",
      "0004_site_clients",
      "0005_skill_config",
      "0006_plan_entitlements",
      "0007_service_actor_constraints",
    ]);
    expect(pending?.tag).toBe("0008_client_audit_log");

    const databaseUrl = await createDatabase(`cerevex_schema_test_${process.pid}_0007`);
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
          index + 1,
          fileHash(entry.tag),
          entry.when,
        ]);
      }
      await setup.query(`SELECT setval(pg_get_serial_sequence('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}', 'id'), $1)`, [
        applied.length,
      ]);
      await seedLegacyRecommendations(setup, process.pid);
      const before = await setup.query(`select to_regclass('os.client_audit_log') as name`);
      expect(before.rows[0]?.name).toBeNull();
    } finally {
      await setup.end();
    }

    const first = await runMigrate(databaseUrl);
    expect(first.code, first.stderr).toBe(0);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const rows = await client.query<{ id: number; hash: string; created_at: string }>(
        `select id, hash, created_at::text from ${migrationsRelation()} order by created_at`,
      );
      expect(rows.rows).toHaveLength(entries.length);
      const stamped = rows.rows.find((row) => Number(row.created_at) === pending!.when);
      expect(stamped?.hash).toBe(fileHash(pending!.tag));
      expect((await client.query(`select to_regclass('os.client_audit_log') as name`)).rows[0]?.name).toBe(
        "client_audit_log",
      );
      const legacy = await client.query<{ title: string; approval_json: Record<string, string | null> }>(
        `select title, approval_json from os.recommendations where title like $1 order by title`,
        [`legacy-backfill-${process.pid}-%`],
      );
      const byTitle = new Map(legacy.rows.map((row) => [row.title, row.approval_json]));
      const prefix = `legacy-backfill-${process.pid}`;
      expect(byTitle.get(`${prefix}-authorized`)?.status).toBe("approved");
      expect(byTitle.get(`${prefix}-authorized`)?.executed_at).toBeNull();
      expect(byTitle.get(`${prefix}-denied`)?.status).toBe("rejected");
      expect(byTitle.get(`${prefix}-proposed`)?.status).toBe("PENDING_APPROVAL");
      expect(byTitle.get(`${prefix}-executed`)?.status).toBe("approved");
      expect(byTitle.get(`${prefix}-executed`)?.executed_by).toBe("cerevex_apply");
      expect(byTitle.get(`${prefix}-executed`)?.executed_at).toBeTruthy();
      const stillPending = await client.query(
        `select count(*)::int as n from os.recommendations
         where status in ('authorized', 'denied')
           and approval_json->>'status' = 'PENDING_APPROVAL'
           and title like $1`,
        [`legacy-backfill-${process.pid}-%`],
      );
      expect(stillPending.rows[0]?.n).toBe(0);
      const actorFk = await client.query<{ confdeltype: string }>(
        `select confdeltype from pg_constraint where conname = 'client_audit_log_actor_id_users_id_fk'`,
      );
      expect(actorFk.rows[0]?.confdeltype).toBe("r");
      const second = await runMigrate(databaseUrl);
      expect(second.code, second.stderr).toBe(0);
      const again = await client.query(`select count(*)::int as n from ${migrationsRelation()}`);
      expect(again.rows[0]?.n).toBe(entries.length);
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

async function seedLegacyRecommendations(client: pg.Client, pid: number) {
  const prefix = `legacy-backfill-${pid}`;
  const seeded = await client.query<{
    workspace_id: string;
    client_id: string;
    account_id: string;
    user_id: string;
  }>(
    `with ws as (
       insert into os.workspaces (name) values ($1) returning id
     ),
     cl as (
       insert into os.clients (workspace_id, name)
       select id, $1 from ws returning id, workspace_id
     ),
     acct as (
       insert into os.ad_accounts (workspace_id, client_id, platform, external_id)
       select workspace_id, id, 'meta', $2 from cl returning id, workspace_id, client_id
     ),
     usr as (
       insert into os.users (email, name, password_hash)
       values ($3, 'Legacy', 'not-a-login') returning id
     )
     select acct.workspace_id, acct.client_id, acct.id as account_id, usr.id as user_id
     from acct, usr`,
    [`${prefix}-workspace`, `${prefix}-account`, `${prefix}@example.com`],
  );
  const row = seeded.rows[0];
  if (!row) throw new Error("legacy seed failed");
  const recs = await client.query<{ id: string; title: string }>(
    `insert into os.recommendations
       (workspace_id, client_id, ad_account_id, type, title, rationale, status)
     values
       ($1, $2, $3, 'pause_waste', $4, 'legacy', 'authorized'),
       ($1, $2, $3, 'pause_waste', $5, 'legacy', 'denied'),
       ($1, $2, $3, 'pause_waste', $6, 'legacy', 'proposed'),
       ($1, $2, $3, 'pause_waste', $7, 'legacy', 'authorized')
     returning id, title`,
    [
      row.workspace_id,
      row.client_id,
      row.account_id,
      `${prefix}-authorized`,
      `${prefix}-denied`,
      `${prefix}-proposed`,
      `${prefix}-executed`,
    ],
  );
  const executed = recs.rows.find((item) => item.title.endsWith("-executed"));
  if (!executed) throw new Error("executed legacy rec missing");
  const decision = await client.query<{ id: string }>(
    `insert into os.decisions (workspace_id, client_id, recommendation_id, user_id, action)
     values ($1, $2, $3, $4, 'authorize') returning id`,
    [row.workspace_id, row.client_id, executed.id, row.user_id],
  );
  const authorization = await client.query<{ id: string }>(
    `insert into os.authorizations (workspace_id, client_id, recommendation_id, decision_id)
     values ($1, $2, $3, $4) returning id`,
    [row.workspace_id, row.client_id, executed.id, decision.rows[0]!.id],
  );
  await client.query(
    `insert into os.apply_jobs (workspace_id, client_id, authorization_id, status, response_json, finished_at)
     values ($1, $2, $3, 'succeeded', '{"writes":true}'::jsonb, now())`,
    [row.workspace_id, row.client_id, authorization.rows[0]!.id],
  );
}
