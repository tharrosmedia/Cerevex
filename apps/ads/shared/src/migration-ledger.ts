import { ADS_DB_SCHEMA } from "@cerevex/contracts";

/**
 * Prod stores the Drizzle journal in the ads schema. The driver default
 * (`drizzle.__drizzle_migrations`) is a different table, and prod has no
 * `drizzle` schema.
 */
export const MIGRATIONS_SCHEMA = ADS_DB_SCHEMA;
export const MIGRATIONS_TABLE = "__drizzle_migrations";

export function migrationsRelation(): string {
  return `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;
}

/**
 * One-time copy for a local or other non-production database whose rows are
 * still in `drizzle.__drizzle_migrations`. Do not run this against production.
 */
export const LEGACY_LEDGER_COPY_SQL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at) SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;`;
