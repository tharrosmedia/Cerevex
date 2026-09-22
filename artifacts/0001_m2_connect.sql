CREATE TABLE "os"."ad_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"parent_external_id" text,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."ad_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"window" text NOT NULL,
	"spend_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"conversions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "os"."ad_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "os"."oauth_credentials" ADD COLUMN "ad_account_id" uuid;--> statement-breakpoint
ALTER TABLE "os"."ad_entities" ADD CONSTRAINT "ad_entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_entities" ADD CONSTRAINT "ad_entities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_entities" ADD CONSTRAINT "ad_entities_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "os"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_metrics" ADD CONSTRAINT "ad_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_metrics" ADD CONSTRAINT "ad_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_metrics" ADD CONSTRAINT "ad_metrics_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "os"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_metrics" ADD CONSTRAINT "ad_metrics_entity_id_ad_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "os"."ad_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_entities_account_idx" ON "os"."ad_entities" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "ad_entities_client_idx" ON "os"."ad_entities" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_entities_account_type_external_idx" ON "os"."ad_entities" USING btree ("ad_account_id","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "ad_metrics_account_idx" ON "os"."ad_metrics" USING btree ("ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_metrics_entity_window_idx" ON "os"."ad_metrics" USING btree ("entity_id","window");--> statement-breakpoint
ALTER TABLE "os"."oauth_credentials" ADD CONSTRAINT "oauth_credentials_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "os"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_credentials_ad_account_idx" ON "os"."oauth_credentials" USING btree ("ad_account_id");