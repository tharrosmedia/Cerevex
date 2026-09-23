/**
 * Shared Neon / Postgres — Product lock.
 *
 * Ads and Brain may share `DATABASE_URL`.
 * Ads migrations target an isolated schema. The Postgres schema name stays `os`
 * (legacy Tharros OS). R5 quarantines that string behind ADS_DB_SCHEMA — do not
 * `ALTER SCHEMA os RENAME`. Renaming would break Neon prod + Railway DATABASE_URL
 * / drizzle journals.
 * Never write ads tables into Brain `public` or pgvector catalogs.
 */

/** Legacy Neon schema name for the Cerevex ads module. Sticky — do not rename. */
export const ADS_DB_SCHEMA = "os" as const;

/** @deprecated R5 alias — use ADS_DB_SCHEMA. Value is still `"os"`. */
export const OS_DB_SCHEMA = ADS_DB_SCHEMA;

export const BRAIN_PUBLIC_SCHEMA = "public" as const;

export type NeonLayout = {
  sharedDatabaseUrl: true;
  adsSchema: typeof ADS_DB_SCHEMA;
  /** @deprecated R5 alias of adsSchema */
  osSchema: typeof ADS_DB_SCHEMA;
  brainForbiddenSchemas: readonly [typeof BRAIN_PUBLIC_SCHEMA, "pgvector"];
};

export const NEON_LAYOUT: NeonLayout = {
  sharedDatabaseUrl: true,
  adsSchema: ADS_DB_SCHEMA,
  osSchema: ADS_DB_SCHEMA,
  brainForbiddenSchemas: [BRAIN_PUBLIC_SCHEMA, "pgvector"],
};
