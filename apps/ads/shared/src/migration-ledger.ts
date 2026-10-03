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
