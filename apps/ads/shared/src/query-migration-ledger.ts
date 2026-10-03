import { closeDb, getPool } from "./db";
import { loadEnv } from "./env";

/**
 * Read-only listing of the ledger `ads:db:migrate` checks:
 * `drizzle.__drizzle_migrations`. Does not migrate and does not write.
 * The Neon smoke migrator writes `os.__drizzle_migrations`, which is a
 * different table.
 */
async function main(): Promise<void> {
  loadEnv();
  const pool = getPool();
  const client = await pool.connect();
  try {
    const applied = await client.query<{ hash: string | null; created_at: string | number }>(
      `select hash, created_at from "drizzle"."__drizzle_migrations" order by created_at`,
    );
    console.log(`drizzle.__drizzle_migrations rows: ${applied.rows.length}`);
    for (const row of applied.rows) {
      console.log(`${row.created_at}\t${String(row.hash ?? "<null>")}`);
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "42P01" || code === "3F000") {
      throw new Error(
        "drizzle.__drizzle_migrations does not exist. ads:db:migrate uses schema drizzle, not os.__drizzle_migrations.",
      );
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
