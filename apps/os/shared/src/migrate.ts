import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "./db";
import { loadEnv } from "./env";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  loadEnv();
  const pool = getPool();
  await pool.query('CREATE SCHEMA IF NOT EXISTS "os"');
  const migrationsFolder = resolve(here, "../drizzle");
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  console.log(`Applied OS migrations from ${migrationsFolder} into schema os`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
