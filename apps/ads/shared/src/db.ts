import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv, requiredEnv } from "./env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

/** Checkout bound for the ads pool. Apply workers must stay under this. */
export const ADS_POOL_MAX = 10;
/** Wait for a new connection or a free pool slot. 0 would wait forever. */
export const ADS_POOL_CONNECTION_TIMEOUT_MS = 10_000;
/** Server-side cap so a stuck statement cannot hold a pool slot indefinitely. */
export const ADS_STATEMENT_TIMEOUT_MS = 30_000;
/** Inngest apply concurrency. Kept below ADS_POOL_MAX so claims can still check out. */
export const APPLY_WORKER_CONCURRENCY = 4;

let pool: pg.Pool | undefined;
let db: Database | undefined;

export function getPool(): pg.Pool {
  loadEnv();
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requiredEnv("DATABASE_URL"),
      max: ADS_POOL_MAX,
      connectionTimeoutMillis: ADS_POOL_CONNECTION_TIMEOUT_MS,
      statement_timeout: ADS_STATEMENT_TIMEOUT_MS,
      query_timeout: ADS_STATEMENT_TIMEOUT_MS,
    });
  }
  return pool;
}

export function getDb(): Database {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

export async function checkDatabase(): Promise<boolean> {
  const client = await getPool().query("select 1 as ok");
  return client.rows[0]?.ok === 1;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
