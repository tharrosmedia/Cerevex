-- Store and client recommendations share os.recommendations.
-- client_id is already NOT NULL from 0000_m1_spine, so this migration does not add it or rewrite it.
-- Existing rows default to scope ad_account with store_id null, then ad_account_id becomes nullable.
-- There is no os store table to reference. store_id is a Brain store id (text), same as os.locations.store_id.
ALTER TABLE "os"."recommendations" ADD COLUMN "scope" text DEFAULT 'ad_account' NOT NULL;
--> statement-breakpoint
ALTER TABLE "os"."recommendations" ADD COLUMN "store_id" text;
--> statement-breakpoint
ALTER TABLE "os"."recommendations" ADD CONSTRAINT "recommendations_scope_check" CHECK ("scope" IN ('ad_account', 'store', 'client'));
--> statement-breakpoint
ALTER TABLE "os"."recommendations" ADD CONSTRAINT "recommendations_scope_ids_check" CHECK (
  (
    "scope" = 'ad_account'
    AND "ad_account_id" IS NOT NULL
    AND "store_id" IS NULL
  )
  OR (
    "scope" = 'store'
    AND "ad_account_id" IS NULL
    AND "store_id" IS NOT NULL
    AND length(btrim("store_id")) > 0
  )
  OR (
    "scope" = 'client'
    AND "ad_account_id" IS NULL
    AND "store_id" IS NULL
  )
);
--> statement-breakpoint
ALTER TABLE "os"."recommendations" ALTER COLUMN "ad_account_id" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "recommendations_store_idx" ON "os"."recommendations" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "recommendations_scope_client_idx" ON "os"."recommendations" USING btree ("workspace_id", "client_id", "scope");
