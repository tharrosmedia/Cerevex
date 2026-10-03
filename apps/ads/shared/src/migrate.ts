import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "./db";
import { loadEnv } from "./env";
import {
  assertMigrationJournal,
  assertMigrationsApplied,
  assertNoSkippedBeforeMigrate,
  type AppliedMigration,
  MigrationJournalError,
} from "./migration-journal";

const here = dirname(fileURLToPath(import.meta.url));

function migrationsFolder(): string {
  const override = process.env.ADS_MIGRATIONS_FOLDER?.trim();
  if (!override) return resolve(here, "../drizzle");
  if (process.env.NODE_ENV !== "test") {
    throw new MigrationJournalError(
      "ADS_MIGRATIONS_FOLDER is honored only when NODE_ENV=test. Refusing to read a foreign migrations folder.",
    );
  }
  return resolve(override);
}

async function readApplied(client: {
  query: (sql: string) => Promise<{ rows: Array<{ hash: string | null; created_at: string | number }> }>;
}): Promise<AppliedMigration[]> {
  try {
    const applied = await client.query(`select hash, created_at from "drizzle"."__drizzle_migrations"`);
    return applied.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "42P01" || code === "3F000") return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const folder = migrationsFolder();
  const entries = assertMigrationJournal(folder);
  loadEnv();
  const pool = getPool();
  const client = await pool.connect();
  try {
    // Isolated schema. Drizzle SQL creates types as "os"."platform" but columns
    // reference unprefixed "platform" — search_path must include os on this client.
    await client.query('CREATE SCHEMA IF NOT EXISTS "os"');
    await client.query("SET search_path TO os, public");
    const db = drizzle(client);
    assertNoSkippedBeforeMigrate(folder, entries, await readApplied(client));
    await migrate(db, { migrationsFolder: folder });
    assertMigrationsApplied(folder, entries, await readApplied(client));
    console.log(`Applied OS migrations from ${folder} into schema os`);
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
