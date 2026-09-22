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
  const client = await pool.connect();
  try {
    // Isolated schema. Drizzle SQL creates types as "os"."platform" but columns
    // reference unprefixed "platform" — search_path must include os on this client.
    await client.query('CREATE SCHEMA IF NOT EXISTS "os"');
    await client.query("SET search_path TO os, public");
    const migrationsFolder = resolve(here, "../drizzle");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    console.log(`Applied OS migrations from ${migrationsFolder} into schema os`);
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
