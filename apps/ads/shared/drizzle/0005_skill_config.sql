-- Skill client/store config. One-way import of profile.md (Brief 1.0 §3).
-- Client rows are slug-keyed and may link os.clients (clientId). Store rows
-- are store_key-keyed. brain_store_id is Brain stores.id with no cross-schema
-- FK (Architecture 1.0). Ad accounts stay on os.clients and are not imported here.
-- The slug check is the scope gate: Level Agency tenants cannot be inserted.
CREATE TABLE "os"."skill_client_configs" (
	"slug" text PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"display_name" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"profile_hash" text NOT NULL,
	"marketing_gate" text NOT NULL,
	"scope_allowed" boolean DEFAULT true NOT NULL,
	"pilot" boolean DEFAULT false NOT NULL,
	"approval_owner_resolved" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"missing_facts_json" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_client_configs_slug_check" CHECK ("slug" IN ('hvac-usa', 'got-ductless', 'kc-prestige-hvac', 'elmar-hvac', 'tharros-media', 'cerevex')),
	CONSTRAINT "skill_client_configs_marketing_gate_check" CHECK ("marketing_gate" IN ('on', 'off')),
	CONSTRAINT "skill_client_configs_scope_check" CHECK ("scope_allowed" = true)
);
--> statement-breakpoint
ALTER TABLE "os"."skill_client_configs" ADD CONSTRAINT "skill_client_configs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "skill_client_configs_client_idx" ON "os"."skill_client_configs" USING btree ("client_id");
--> statement-breakpoint
CREATE TABLE "os"."skill_store_configs" (
	"client_slug" text NOT NULL,
	"store_key" text NOT NULL,
	"brain_store_id" text,
	"role" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_store_configs_client_slug_store_key_pk" PRIMARY KEY("client_slug","store_key")
);
--> statement-breakpoint
ALTER TABLE "os"."skill_store_configs" ADD CONSTRAINT "skill_store_configs_client_slug_skill_client_configs_slug_fk" FOREIGN KEY ("client_slug") REFERENCES "os"."skill_client_configs"("slug") ON DELETE cascade ON UPDATE no action;
