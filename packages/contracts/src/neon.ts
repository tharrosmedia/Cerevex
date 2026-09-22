/**
 * Shared Neon / Postgres — Product lock.
 *
 * OS and Brain may share `DATABASE_URL`.
 * OS migrations target an isolated schema (default `os`).
 * Never write OS tables into Brain `public` or pgvector catalogs.
 * Product M3 writes only to schema `os`. Do not migrate `public`.
 */

export const OS_DB_SCHEMA = "os" as const;
export const BRAIN_PUBLIC_SCHEMA = "public" as const;

export type NeonLayout = {
  sharedDatabaseUrl: true;
  osSchema: typeof OS_DB_SCHEMA;
  brainForbiddenSchemas: readonly [typeof BRAIN_PUBLIC_SCHEMA, "pgvector"];
};

export const NEON_LAYOUT: NeonLayout = {
  sharedDatabaseUrl: true,
  osSchema: OS_DB_SCHEMA,
  brainForbiddenSchemas: [BRAIN_PUBLIC_SCHEMA, "pgvector"],
};
