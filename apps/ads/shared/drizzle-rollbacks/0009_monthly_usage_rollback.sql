-- Rollback for 0009_monthly_usage. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0009_monthly_usage.sql file. created_at is that journal entry's when.
DROP TABLE IF EXISTS "os"."usage_events";
DROP TABLE IF EXISTS "os"."usage_counters";
DELETE FROM "os"."__drizzle_migrations"
WHERE "hash" = '77ee1159160c82d1b11be42bfe945b9f2e05ab79708a98c882161de80c905608'
  AND "created_at" = 1791300000000;
