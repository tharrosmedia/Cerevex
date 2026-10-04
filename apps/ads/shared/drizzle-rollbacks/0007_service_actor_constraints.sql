-- Rollback for 0007_service_actor_constraints.
-- Drops the one-job-per-authorization index, then restores user_id NOT NULL.
-- Pending rows stored for the service actor have a null user_id and are removed
-- so the NOT NULL constraint can be put back. Human pending rows are kept.
DROP INDEX IF EXISTS "os"."apply_jobs_authorization_uidx";
DELETE FROM "os"."oauth_pending_connections" WHERE "user_id" IS NULL;
ALTER TABLE "os"."oauth_pending_connections" ALTER COLUMN "user_id" SET NOT NULL;
