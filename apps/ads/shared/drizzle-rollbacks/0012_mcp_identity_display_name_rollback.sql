-- Rollback for 0012_mcp_identity_display_name. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0012_mcp_identity_display_name.sql file. created_at is that journal entry's when.
DROP INDEX IF EXISTS "os"."mcp_identities_workspace_display_name_idx";
ALTER TABLE "os"."mcp_identities" DROP CONSTRAINT IF EXISTS "mcp_identities_display_name_check";
ALTER TABLE "os"."mcp_identities" DROP COLUMN IF EXISTS "display_name";
DELETE FROM "os"."__drizzle_migrations"
WHERE "hash" = 'c53fbf59cb2c87467191b4bc5156b2cf8f2e07d1d45e11b9d68857d80f40f368'
  AND "created_at" = 1791600000000;
