-- Rollback for 0010_recommendation_scope. Not a journal entry. Do not run this with drizzle migrate.
-- Hash is sha256 of the full 0010_recommendation_scope.sql file. created_at is that journal entry's when.
-- Refuses when any row is not an ad-account recommendation. Those rows have no home in the pre-0010 table.
DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "os"."recommendations"
    WHERE "scope" IS DISTINCT FROM 'ad_account'
       OR "ad_account_id" IS NULL
       OR "store_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      '0010_recommendation_scope rollback refused: a recommendation is not ad_account-scoped';
  END IF;
END
$rollback$;
DROP INDEX IF EXISTS "os"."recommendations_store_idx";
DROP INDEX IF EXISTS "os"."recommendations_scope_client_idx";
ALTER TABLE "os"."recommendations" DROP CONSTRAINT IF EXISTS "recommendations_scope_ids_check";
ALTER TABLE "os"."recommendations" DROP CONSTRAINT IF EXISTS "recommendations_scope_check";
ALTER TABLE "os"."recommendations" DROP COLUMN IF EXISTS "store_id";
ALTER TABLE "os"."recommendations" DROP COLUMN IF EXISTS "scope";
ALTER TABLE "os"."recommendations" ALTER COLUMN "ad_account_id" SET NOT NULL;
DELETE FROM "os"."__drizzle_migrations"
WHERE "hash" = '05b0682165d42d22e0cc31ed49b12fbf6554f32df9e1a18abfa15b372ed54f18'
  AND "created_at" = 1791400000000;
