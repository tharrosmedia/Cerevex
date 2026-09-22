import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["os"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tharros:tharros@127.0.0.1:54329/tharros",
  },
});
