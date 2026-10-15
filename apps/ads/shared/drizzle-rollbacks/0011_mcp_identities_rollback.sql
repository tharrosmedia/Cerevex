-- Rollback for 0011_mcp_identities. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0011_mcp_identities.sql file. created_at is that journal entry's when.
DROP TABLE IF EXISTS "os"."mcp_identity_grants";
DROP TABLE IF EXISTS "os"."mcp_identities";
DELETE FROM "os"."__drizzle_migrations"
WHERE "hash" = '2a4cae94767cdd173ada9f0282c01208fb08e4d5b86cf9b9882adec4c84c4c13'
  AND "created_at" = 1791500000000;
