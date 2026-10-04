-- Rollback for 0008_client_audit_log. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0008_client_audit_log.sql file. created_at is that journal entry's when.
DROP TRIGGER IF EXISTS "client_audit_log_no_truncate" ON "os"."client_audit_log";
DROP TRIGGER IF EXISTS "client_audit_log_no_update" ON "os"."client_audit_log";
DROP TRIGGER IF EXISTS "client_audit_log_no_delete" ON "os"."client_audit_log";
DROP FUNCTION IF EXISTS "os"."reject_client_audit_log_mutation"();
DROP TABLE IF EXISTS "os"."client_audit_log";
ALTER TABLE "os"."recommendations" DROP COLUMN IF EXISTS "approval_json";
DELETE FROM "os"."__drizzle_migrations"
WHERE "hash" = '678c0b4fc3d4737d3c5d2cf344403f3218c45cd0102fa2b6086edeec58dd442a'
  AND "created_at" = 1791200000000;
