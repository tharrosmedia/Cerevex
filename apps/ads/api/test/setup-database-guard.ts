import { loadEnv } from "@tharros/ads-shared/env";
import { assertSafeTestDatabase } from "@tharros/ads-shared/test-database";

loadEnv();

assertSafeTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  purpose: "ads API tests",
});
