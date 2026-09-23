#!/usr/bin/env bun
/**
 * Railway-safe one-shot migrator for isolated schema `os` (Cerevex ads module).
 * Filename keeps os- prefix so existing Railway one-shot commands keep working.
 *
 * - Requires DATABASE_URL
 * - CREATE SCHEMA IF NOT EXISTS os
 * - SET search_path TO os, public
 * - Applies each Drizzle journal file exactly once via os.__drizzle_migrations
 *   (hash + created_at, matching drizzle-orm/node-postgres)
 * - Does NOT seed
 * - Does NOT apply Brain public migrations
 * - Never logs DATABASE_URL
 *
 * Operator:
 *   DATABASE_URL=... bun artifacts/os-neon-migrate.ts
 *
 * Repo smoke (reads apps/ads/shared/drizzle journal):
 *   DATABASE_URL=... bun scripts/os-neon-smoke-migrate.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type OsMigration = {
  tag: string;
  filename: string;
  when: number;
  sql: string;
};

export type OsMigrateSummary = {
  ok: boolean;
  migrationsApplied: string[];
  osTables: string[];
  publicTableCount: number;
  publicUnchanged: boolean;
};

export type OsMigrateOptions = {
  migrationsDir?: string;
  journalPath?: string;
  databaseUrl?: string;
};

type QueryResult = { rows: Record<string, unknown>[] };

type SqlClient = {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
  end: () => Promise<void>;
};

type BunSqlLike = {
  unsafe: (text: string, params?: unknown[]) => Promise<unknown>;
  close?: () => Promise<void>;
  end?: () => Promise<void>;
};

const JOURNAL_TABLE = "__drizzle_migrations";
/** Sticky Neon schema name (`ADS_DB_SCHEMA`). Do not ALTER SCHEMA. Filename keeps os- for Railway. */
const SCHEMA = "os";

function hereDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function redact(value: string, databaseUrl?: string): string {
  let next = value.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`]+/g, "[redacted-url]");
  if (databaseUrl && next.includes(databaseUrl)) {
    next = next.split(databaseUrl).join("[DATABASE_URL]");
  }
  return next;
}

function errorMessage(error: unknown, databaseUrl?: string): string {
  if (error instanceof Error) {
    return redact(error.message, databaseUrl);
  }
  return redact(String(error), databaseUrl);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function assertOsQualified(sqlText: string, filename: string): void {
  if (/CREATE\s+(TABLE|TYPE)\s+"public"\./i.test(sqlText)) {
    throw new Error(`${filename} targets public schema; refusing to apply`);
  }
  if (!/"(os)"\./.test(sqlText)) {
    throw new Error(`${filename} is not schema-qualified to os; refusing to apply`);
  }
}

function readJournalMigrations(migrationsDir: string, journalPath: string): OsMigration[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const filename = `${entry.tag}.sql`;
      const sql = readFileSync(resolve(migrationsDir, filename), "utf8");
      assertOsQualified(sql, filename);
      return { tag: entry.tag, filename, when: entry.when, sql };
    });
}

function readEmbeddedMigrations(dir: string): OsMigration[] {
  const extras: Array<{ tag: string; when: number }> = [
    { tag: "0000_m1_spine", when: 1790048328345 },
    { tag: "0001_m2_connect", when: 1790075682637 },
    { tag: "0002_m5_apply", when: 1790200000000 },
  ];
  const bundlePath = resolve(dir, "os-migrate-bundle.json");
  const fromBundle: OsMigration[] = [];
  if (existsSync(bundlePath)) {
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
      migrations: { filename: string; tag: string; when: number; sql: string }[];
    };
    for (const entry of bundle.migrations) {
      const sibling = resolve(dir, entry.filename);
      const sql = existsSync(sibling) ? readFileSync(sibling, "utf8") : entry.sql;
      assertOsQualified(sql, entry.filename);
      fromBundle.push({ tag: entry.tag, filename: entry.filename, when: entry.when, sql });
    }
  }
  const seen = new Set(fromBundle.map((row) => row.tag));
  const extraRows = extras
    .filter((entry) => !seen.has(entry.tag))
    .map((entry) => {
      const filename = `${entry.tag}.sql`;
      const sql = readFileSync(resolve(dir, filename), "utf8");
      assertOsQualified(sql, filename);
      return { ...entry, filename, sql };
    });
  return [...fromBundle, ...extraRows];
}

export function loadOsMigrations(options: OsMigrateOptions = {}): OsMigration[] {
  if (options.journalPath && options.migrationsDir) {
    return readJournalMigrations(options.migrationsDir, options.journalPath);
  }
  return readEmbeddedMigrations(options.migrationsDir ?? hereDir());
}

async function openClient(databaseUrl: string): Promise<SqlClient> {
  const BunGlobal = (
    globalThis as {
      Bun?: { SQL?: new (options: string | { url: string; max?: number }) => BunSqlLike };
    }
  ).Bun;
  if (BunGlobal?.SQL) {
    // Single connection so SET search_path and BEGIN/COMMIT stay on the same session.
    const sql = new BunGlobal.SQL({ url: databaseUrl, max: 1 });
    return {
      async query(text, params) {
        const result = params?.length ? await sql.unsafe(text, params) : await sql.unsafe(text);
        if (Array.isArray(result)) {
          return { rows: result as Record<string, unknown>[] };
        }
        if (result && typeof result === "object" && "rows" in result) {
          return { rows: (result as QueryResult).rows };
        }
        return { rows: [] };
      },
      async end() {
        if (typeof sql.close === "function") {
          await sql.close();
          return;
        }
        if (typeof sql.end === "function") {
          await sql.end();
        }
      },
    };
  }

  const pg = await import("pg");
  const Client = (pg as { default?: { Client: typeof import("pg").Client }; Client?: typeof import("pg").Client })
    .default?.Client ?? (pg as { Client: typeof import("pg").Client }).Client;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return {
    query: async (text, params) => {
      const res = await client.query(text, params);
      return { rows: res.rows as Record<string, unknown>[] };
    },
    end: async () => {
      await client.end();
    },
  };
}

async function listTables(client: SqlClient, schemaName: string): Promise<string[]> {
  const result = await client.query(
    `SELECT tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = $1
     ORDER BY tablename`,
    [schemaName],
  );
  return result.rows.map((row) => String(row.tablename));
}

function alreadyApplied(
  applied: Array<{ hash: string; created_at: string | number | bigint }>,
  hash: string,
  when: number,
): boolean {
  return applied.some((row) => {
    const createdAt = Number(row.created_at);
    return row.hash === hash || createdAt === when;
  });
}

export async function runOsNeonMigrate(options: OsMigrateOptions = {}): Promise<OsMigrateSummary> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const migrations = loadOsMigrations(options);
  const client = await openClient(databaseUrl);

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${SCHEMA}"."${JOURNAL_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`,
    );

    const publicBefore = await listTables(client, "public");

    const journal = await client.query(
      `SELECT hash, created_at FROM "${SCHEMA}"."${JOURNAL_TABLE}"`,
    );
    const appliedRows = journal.rows as Array<{ hash: string; created_at: string | number | bigint }>;
    const migrationsApplied: string[] = [];

    for (const migration of migrations) {
      const hash = sha256(migration.sql);
      if (alreadyApplied(appliedRows, hash, migration.when)) {
        continue;
      }

      await client.query("BEGIN");
      try {
        for (const statement of splitStatements(migration.sql)) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO "${SCHEMA}"."${JOURNAL_TABLE}" (hash, created_at) VALUES ($1, $2)`,
          [hash, migration.when],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      appliedRows.push({ hash, created_at: migration.when });
      migrationsApplied.push(migration.tag);
    }

    const publicAfter = await listTables(client, "public");
    const osTables = await listTables(client, SCHEMA);

    return {
      ok: true,
      migrationsApplied,
      osTables,
      publicTableCount: publicAfter.length,
      publicUnchanged: JSON.stringify(publicBefore) === JSON.stringify(publicAfter),
    };
  } finally {
    await client.end();
  }
}

function isMainModule(): boolean {
  const bunMain = (globalThis as { Bun?: { main?: string } }).Bun?.main;
  if (typeof bunMain === "string") {
    return bunMain === fileURLToPath(import.meta.url);
  }
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    const summary = await runOsNeonMigrate();
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: errorMessage(error, process.env.DATABASE_URL),
        migrationsApplied: [],
        osTables: [],
        publicTableCount: 0,
        publicUnchanged: false,
      }),
    );
    process.exit(1);
  }
}

if (isMainModule()) {
  void main();
}
