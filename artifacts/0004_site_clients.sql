ALTER TABLE "os"."clients" ADD COLUMN IF NOT EXISTS "site_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_workspace_site_idx" ON "os"."clients" USING btree ("workspace_id","site_id");
--> statement-breakpoint
ALTER TABLE "os"."ad_accounts" ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "os"."oauth_pending_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"user_id" uuid NOT NULL,
	"encrypted_payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."oauth_pending_connections" ADD CONSTRAINT "oauth_pending_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."oauth_pending_connections" ADD CONSTRAINT "oauth_pending_connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_pending_client_idx" ON "os"."oauth_pending_connections" USING btree ("client_id");
