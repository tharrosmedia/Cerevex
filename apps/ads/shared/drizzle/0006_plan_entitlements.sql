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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION os.enforce_scholarship_location_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  client_plan text;
  active_count integer;
BEGIN
  -- A write that cannot add an active location takes no lock. Sync and
  -- reconnect update the same row and must not wait on the client.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND OLD.client_id IS NOT DISTINCT FROM NEW.client_id
     AND OLD.store_id IS NOT DISTINCT FROM NEW.store_id THEN
    RETURN NEW;
  END IF;

  -- Lock order: client row, then the advisory lock. NO KEY UPDATE still
  -- serializes these writers and does not block a foreign-key KEY SHARE.
  -- READ COMMITTED takes a fresh snapshot after the row wait.
  SELECT plan INTO client_plan
  FROM os.clients
  WHERE id = NEW.client_id
  FOR NO KEY UPDATE;

  PERFORM pg_advisory_xact_lock(hashtext('os.scholarship'), hashtext(NEW.client_id::text));

  IF client_plan IS DISTINCT FROM 'scholarship' THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO active_count
  FROM os.locations
  WHERE client_id = NEW.client_id
    AND status = 'active'
    AND id IS DISTINCT FROM NEW.id
    AND store_id IS DISTINCT FROM NEW.store_id;

  IF active_count >= 1 THEN
    RAISE EXCEPTION 'This Scholarship includes 1 location. Turn the current location off to switch, or move to the paid plan to add every location.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS locations_scholarship_limit ON os.locations;
--> statement-breakpoint
CREATE TRIGGER locations_scholarship_limit
  BEFORE INSERT OR UPDATE ON os.locations
  FOR EACH ROW
  EXECUTE FUNCTION os.enforce_scholarship_location_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION os.enforce_scholarship_ad_account_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  client_plan text;
  active_count integer;
  platform_key text;
BEGIN
  -- A write that cannot add an active account takes no lock. A sync status
  -- change and a reconnect of the same account are in that set.
  IF NEW.connection_status = 'disconnected' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.connection_status IS DISTINCT FROM 'disconnected'
     AND OLD.client_id IS NOT DISTINCT FROM NEW.client_id
     AND OLD.platform IS NOT DISTINCT FROM NEW.platform
     AND OLD.external_id IS NOT DISTINCT FROM NEW.external_id THEN
    RETURN NEW;
  END IF;

  -- Same order as the location trigger: client row, then advisory lock.
  SELECT plan INTO client_plan
  FROM os.clients
  WHERE id = NEW.client_id
  FOR NO KEY UPDATE;

  PERFORM pg_advisory_xact_lock(hashtext('os.scholarship'), hashtext(NEW.client_id::text));

  IF client_plan IS DISTINCT FROM 'scholarship' THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO active_count
  FROM os.ad_accounts
  WHERE client_id = NEW.client_id
    AND platform = NEW.platform
    AND connection_status <> 'disconnected'
    AND id IS DISTINCT FROM NEW.id
    AND (platform, external_id) IS DISTINCT FROM (NEW.platform, NEW.external_id);

  IF active_count >= 1 THEN
    platform_key := lower(NEW.platform::text);
    IF platform_key = 'meta' THEN
      RAISE EXCEPTION 'This Scholarship includes 1 Meta ad account. Disconnect the current one to switch, or move to the paid plan for unlimited ad accounts.'
        USING ERRCODE = '23514';
    ELSIF platform_key = 'google' THEN
      RAISE EXCEPTION 'This Scholarship includes 1 Google Ads account. Disconnect the current one to switch, or move to the paid plan for unlimited ad accounts.'
        USING ERRCODE = '23514';
    ELSE
      RAISE EXCEPTION 'This Scholarship includes 1 % ad account. Disconnect the current one to switch, or move to the paid plan for unlimited ad accounts.', NEW.platform::text
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ad_accounts_scholarship_limit ON os.ad_accounts;
--> statement-breakpoint
CREATE TRIGGER ad_accounts_scholarship_limit
  BEFORE INSERT OR UPDATE ON os.ad_accounts
  FOR EACH ROW
  EXECUTE FUNCTION os.enforce_scholarship_ad_account_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION os.enforce_scholarship_plan_downgrade()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  loc_count integer;
  platform_name text;
  platform_key text;
BEGIN
  IF NEW.plan IS DISTINCT FROM 'scholarship' OR OLD.plan = 'scholarship' THEN
    RETURN NEW;
  END IF;

  -- The UPDATE already holds this client row. The advisory lock comes second.
  PERFORM pg_advisory_xact_lock(hashtext('os.scholarship'), hashtext(NEW.id::text));

  SELECT count(*)::integer INTO loc_count
  FROM os.locations
  WHERE client_id = NEW.id
    AND status = 'active';

  IF loc_count > 1 THEN
    RAISE EXCEPTION 'This account has more than one location turned on. Turn the extra locations off before moving to the Scholarship.'
      USING ERRCODE = '23514';
  END IF;

  SELECT platform INTO platform_name
  FROM os.ad_accounts
  WHERE client_id = NEW.id
    AND connection_status <> 'disconnected'
  GROUP BY platform
  HAVING count(*) > 1
  ORDER BY platform
  LIMIT 1;

  IF platform_name IS NOT NULL THEN
    platform_key := lower(platform_name);
    IF platform_key = 'meta' THEN
      RAISE EXCEPTION 'This account has more than one Meta ad account connected. Disconnect the extra ones before moving to the Scholarship.'
        USING ERRCODE = '23514';
    ELSIF platform_key = 'google' THEN
      RAISE EXCEPTION 'This account has more than one Google Ads account connected. Disconnect the extra ones before moving to the Scholarship.'
        USING ERRCODE = '23514';
    ELSE
      RAISE EXCEPTION 'This account has more than one % ad account connected. Disconnect the extra ones before moving to the Scholarship.', platform_name
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS clients_scholarship_downgrade ON os.clients;
--> statement-breakpoint
CREATE TRIGGER clients_scholarship_downgrade
  BEFORE UPDATE OF plan ON os.clients
  FOR EACH ROW
  EXECUTE FUNCTION os.enforce_scholarship_plan_downgrade();
