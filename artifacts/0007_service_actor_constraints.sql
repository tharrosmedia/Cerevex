-- Service actor: pending OAuth may have no users.id, and one apply job per authorization.
-- IF EXISTS covers a journal that has not created the pending-connection table yet.
ALTER TABLE IF EXISTS "os"."oauth_pending_connections" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
DELETE FROM "os"."apply_jobs" AS extra
WHERE extra.id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY authorization_id ORDER BY created_at, id) AS n
    FROM "os"."apply_jobs"
  ) ranked
  WHERE n > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "apply_jobs_authorization_uidx" ON "os"."apply_jobs" USING btree ("authorization_id");
