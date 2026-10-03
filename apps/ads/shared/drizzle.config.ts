import { ADS_DB_SCHEMA } from "@cerevex/contracts";
import { defineConfig } from "drizzle-kit";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./src/migration-ledger";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: [ADS_DB_SCHEMA],
  migrations: {
    schema: MIGRATIONS_SCHEMA,
    table: MIGRATIONS_TABLE,
  },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tharros:tharros@127.0.0.1:54329/tharros",
  },
});
