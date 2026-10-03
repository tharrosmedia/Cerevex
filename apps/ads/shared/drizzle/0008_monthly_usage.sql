CREATE TABLE IF NOT EXISTS "os"."usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_id" text NOT NULL,
	"outcome" text NOT NULL,
	"counted" boolean NOT NULL,
	"period_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."usage_events" ADD CONSTRAINT "usage_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "os"."usage_events" ADD CONSTRAINT "usage_events_kind_check" CHECK ("kind" IN ('creative_variations', 'seo_jobs'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "os"."usage_events" ADD CONSTRAINT "usage_events_outcome_check" CHECK ("outcome" IN ('created', 'rejected', 'duplicate', 'merged'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_client_kind_item_idx" ON "os"."usage_events" USING btree ("client_id","kind","item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_client_period_idx" ON "os"."usage_events" USING btree ("client_id","kind","period_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "os"."usage_counters" (
	"client_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_pk" PRIMARY KEY("client_id","kind","period_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."usage_counters" ADD CONSTRAINT "usage_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "os"."usage_counters" ADD CONSTRAINT "usage_counters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "os"."usage_counters" ADD CONSTRAINT "usage_counters_kind_check" CHECK ("kind" IN ('creative_variations', 'seo_jobs'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
