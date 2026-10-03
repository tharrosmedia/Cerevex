-- Rollback for 0007_client_audit_log. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0007_client_audit_log.sql file. created_at is that journal entry's when.
DROP TRIGGER IF EXISTS "client_audit_log_no_truncate" ON "os"."client_audit_log";
DROP TRIGGER IF EXISTS "client_audit_log_no_update" ON "os"."client_audit_log";
DROP TRIGGER IF EXISTS "client_audit_log_no_delete" ON "os"."client_audit_log";
DROP FUNCTION IF EXISTS "os"."reject_client_audit_log_mutation"();
DROP TABLE IF EXISTS "os"."client_audit_log";
ALTER TABLE "os"."recommendations" DROP COLUMN IF EXISTS "approval_json";
DELETE FROM "drizzle"."__drizzle_migrations"
WHERE "hash" = '30473096d7ebcc2ccefd997c5741233d3454a165324fde1a1700522e4831b49d'
  AND "created_at" = 1791200000000;
