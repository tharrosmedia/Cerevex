ALTER TABLE "os"."ad_accounts" ADD COLUMN "frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "os"."apply_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_jobs_idempotency_idx" ON "os"."apply_jobs" USING btree ("idempotency_key");
