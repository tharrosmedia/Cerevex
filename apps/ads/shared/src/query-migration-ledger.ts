import { closeDb, getPool } from "./db";
import { loadEnv } from "./env";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, migrationsRelation } from "./migration-ledger";

/**
 * Read-only listing of the ledger `ads:db:migrate` checks:
 * `os.__drizzle_migrations`. Does not migrate and does not write.
 */
async function main(): Promise<void> {
  loadEnv();
  const pool = getPool();
  const client = await pool.connect();
  try {
    const applied = await client.query<{ hash: string | null; created_at: string | number }>(
      `select hash, created_at from ${migrationsRelation()} order by created_at`,
    );
    console.log(`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} rows: ${applied.rows.length}`);
    for (const row of applied.rows) {
      console.log(`${row.created_at}\t${String(row.hash ?? "<null>")}`);
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "42P01" || code === "3F000") {
      throw new Error(`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} does not exist.`);
    }
    throw error;
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
