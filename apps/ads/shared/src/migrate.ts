import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "./db";
import { loadEnv } from "./env";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, migrationsRelation } from "./migration-ledger";
import {
  assertMigrationJournal,
  assertMigrationsApplied,
  assertNoSkippedBeforeMigrate,
  assertPopulatedSchemaHasLedger,
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

type QueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function postgresCode(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof (current as { code: unknown }).code === "string") {
      return (current as { code: string }).code;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }
  return "";
}

async function readApplied(client: QueryClient): Promise<AppliedMigration[]> {
  try {
    const applied = await client.query(`select hash, created_at from ${migrationsRelation()}`);
    return applied.rows.map((row) => ({
      hash: (row.hash as string | null) ?? null,
      createdAt: Number(row.created_at),
    }));
  } catch (error) {
    const code = postgresCode(error);
    if (code === "42P01" || code === "3F000") return [];
    if (code === "42501") {
      throw new MigrationJournalError(
        `Refusing to migrate. Cannot read ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (42501).`,
      );
    }
    throw error;
  }
}

async function ledgerShape(client: QueryClient): Promise<{
  otherOsTables: number;
  ledgerRows: number | null;
  legacyLedgerRows: number;
}> {
  const osTables = await client.query(
    `select c.relname as relname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind = 'r'`,
    [MIGRATIONS_SCHEMA],
  );
  const names = osTables.rows.map((row) => String(row.relname));
  const ledgerPresent = names.includes(MIGRATIONS_TABLE);
  let ledgerRows: number | null = null;
  if (ledgerPresent) {
    const count = await client.query(`select count(*)::int as n from ${migrationsRelation()}`);
    ledgerRows = Number(count.rows[0]?.n ?? 0);
  }
  const legacyName = await client.query(`select to_regclass('drizzle.__drizzle_migrations') as name`);
  let legacyLedgerRows = 0;
  if (legacyName.rows[0]?.name) {
    const count = await client.query(`select count(*)::int as n from drizzle.__drizzle_migrations`);
    legacyLedgerRows = Number(count.rows[0]?.n ?? 0);
  }
  return {
    otherOsTables: names.filter((name) => name !== MIGRATIONS_TABLE).length,
    ledgerRows,
    legacyLedgerRows,
  };
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
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(`SET search_path TO ${MIGRATIONS_SCHEMA}, public`);
    const db = drizzle(client);
    const applied = await readApplied(client);
    assertPopulatedSchemaHasLedger(await ledgerShape(client));
    assertNoSkippedBeforeMigrate(folder, entries, applied);
    await migrate(db, {
      migrationsFolder: folder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
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
