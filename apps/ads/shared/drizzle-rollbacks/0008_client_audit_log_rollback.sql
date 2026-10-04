-- Rollback for 0008_client_audit_log. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0008_client_audit_log.sql file. created_at is that journal entry's when.
-- Dropping approval_json removes the legacy lifecycle backfill with the column.
DROP TRIGGER IF EXISTS "client_audit_log_no_truncate" ON "os"."client_audit_log";
DROP TRIGGER IF EXISTS "client_audit_log_no_update" ON "os"."client_audit_log";
DROP TRIGGER IF EXISTS "client_audit_log_no_delete" ON "os"."client_audit_log";
DROP FUNCTION IF EXISTS "os"."reject_client_audit_log_mutation"();
DROP TABLE IF EXISTS "os"."client_audit_log";
ALTER TABLE "os"."recommendations" DROP COLUMN IF EXISTS "approval_json";
DELETE FROM "os"."__drizzle_migrations"
WHERE "hash" = 'efd9dc6f75a7320482bb4bc86665c1197630bab8a0510a3ecc6b4fa0bcd2375f'
  AND "created_at" = 1791200000000;
