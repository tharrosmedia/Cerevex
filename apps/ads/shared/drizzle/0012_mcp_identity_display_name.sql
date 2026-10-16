-- Owner-facing label for an MCP connector identity.
-- name stays the immutable slug used by token verify and logs.
-- Existing rows copy name into display_name.
-- Reversal: apps/ads/shared/drizzle-rollbacks/0012_mcp_identity_display_name_rollback.sql
-- drops the display name index, check, and column, then deletes this journal row.
-- Do not put the rollback file in the drizzle journal.
ALTER TABLE "os"."mcp_identities" ADD COLUMN "display_name" text;
--> statement-breakpoint
UPDATE "os"."mcp_identities" SET "display_name" = "name" WHERE "display_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "os"."mcp_identities" ALTER COLUMN "display_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "os"."mcp_identities" ADD CONSTRAINT "mcp_identities_display_name_check" CHECK (
	char_length("display_name") BETWEEN 1 AND 64
	AND "display_name" = btrim("display_name")
	AND "display_name" !~ '[[:cntrl:]]'
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_identities_workspace_display_name_idx" ON "os"."mcp_identities" USING btree ("workspace_id", lower("display_name"));
