import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv, requiredEnv } from "./env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Database | undefined;

export function getPool(): pg.Pool {
  loadEnv();
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requiredEnv("DATABASE_URL"),
      max: 10,
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
