import { loadEnv } from "@tharros/ads-shared/env";
import { assertSafeTestDatabase } from "@tharros/ads-shared/server";

loadEnv();

assertSafeTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  purpose: "ads API tests",
});
