CREATE TABLE "os"."analytics_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"connector_id" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"label" text DEFAULT 'Funnel' NOT NULL,
	"pixel_token" text,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"connection_id" uuid,
	"name" text NOT NULL,
	"source" text DEFAULT 'first_party' NOT NULL,
	"url" text,
	"referrer" text,
	"platform" text,
	"campaign" text,
	"click_id" text,
	"properties_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."lp_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"url" text NOT NULL,
	"title" text,
	"headline" text,
	"body_text" text,
	"offer_text" text,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "os"."analytics_connections" ADD CONSTRAINT "analytics_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."analytics_connections" ADD CONSTRAINT "analytics_connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."funnel_events" ADD CONSTRAINT "funnel_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."funnel_events" ADD CONSTRAINT "funnel_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."funnel_events" ADD CONSTRAINT "funnel_events_connection_id_analytics_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "os"."analytics_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."lp_snapshots" ADD CONSTRAINT "lp_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."lp_snapshots" ADD CONSTRAINT "lp_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "analytics_connections_workspace_idx" ON "os"."analytics_connections" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_connections_workspace_connector_client_idx" ON "os"."analytics_connections" USING btree ("workspace_id","connector_id","client_id");
--> statement-breakpoint
CREATE INDEX "funnel_events_workspace_idx" ON "os"."funnel_events" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "funnel_events_occurred_idx" ON "os"."funnel_events" USING btree ("occurred_at");
--> statement-breakpoint
CREATE INDEX "funnel_events_name_idx" ON "os"."funnel_events" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "lp_snapshots_workspace_idx" ON "os"."lp_snapshots" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "lp_snapshots_url_idx" ON "os"."lp_snapshots" USING btree ("url");
