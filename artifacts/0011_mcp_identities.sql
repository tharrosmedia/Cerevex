-- Agent identities for the Cerevex MCP connector.
-- The raw bearer token is never stored. token_hash is sha256 hex of the token.
-- Reversal: apps/ads/shared/drizzle-rollbacks/0011_mcp_identities_rollback.sql
-- drops os.mcp_identity_grants and os.mcp_identities, then deletes this journal row.
-- Do not put the rollback file in the drizzle journal.
CREATE TABLE "os"."mcp_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_identities_name_check" CHECK ("name" ~ '^[a-z0-9-]{2,40}$'),
	CONSTRAINT "mcp_identities_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mcp_identities_scopes_check" CHECK (
		"scopes" = '["cerevex.read"]'::jsonb
		OR "scopes" = '["cerevex.recs.submit"]'::jsonb
		OR "scopes" = '["cerevex.read","cerevex.recs.submit"]'::jsonb
	)
);
--> statement-breakpoint
CREATE TABLE "os"."mcp_identity_grants" (
	"identity_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_identity_grants_identity_id_client_id_pk" PRIMARY KEY("identity_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "os"."mcp_identities" ADD CONSTRAINT "mcp_identities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."mcp_identities" ADD CONSTRAINT "mcp_identities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "os"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."mcp_identity_grants" ADD CONSTRAINT "mcp_identity_grants_identity_id_mcp_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "os"."mcp_identities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."mcp_identity_grants" ADD CONSTRAINT "mcp_identity_grants_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_identities_token_hash_idx" ON "os"."mcp_identities" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_identities_workspace_name_idx" ON "os"."mcp_identities" USING btree ("workspace_id","name");
--> statement-breakpoint
CREATE INDEX "mcp_identity_grants_client_idx" ON "os"."mcp_identity_grants" USING btree ("client_id");
