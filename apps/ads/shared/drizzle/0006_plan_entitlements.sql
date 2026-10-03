ALTER TABLE "os"."clients" ADD COLUMN IF NOT EXISTS "plan" text DEFAULT 'paid' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "os"."clients" ADD CONSTRAINT "clients_plan_check" CHECK ("plan" IN ('paid', 'scholarship'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "os"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"store_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."locations" ADD CONSTRAINT "locations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."locations" ADD CONSTRAINT "locations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "os"."locations" ADD CONSTRAINT "locations_status_check" CHECK ("status" IN ('active', 'inactive'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locations_client_store_idx" ON "os"."locations" USING btree ("client_id","store_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_client_status_idx" ON "os"."locations" USING btree ("client_id","status");
--> statement-breakpoint
INSERT INTO "os"."locations" ("workspace_id", "client_id", "store_id", "status")
SELECT "workspace_id", "id", "site_id", 'active'
FROM "os"."clients"
WHERE "site_id" IS NOT NULL
ON CONFLICT ("client_id", "store_id") DO NOTHING;
