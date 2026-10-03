-- Skills slice 1 PR 2. Brief 1.0 §4.3 approve/apply record and append-only client audit log.
-- Numbered 0007. Pricing #52 owns 0006. Rebase this journal entry after that migration merges.
ALTER TABLE "os"."recommendations" ADD COLUMN "approval_json" jsonb DEFAULT '{"status":"PENDING_APPROVAL","approved_by":null,"approved_at":null,"executed_by":null,"executed_at":null,"apply_result":null,"rolled_back_by":null,"rolled_back_at":null}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "os"."client_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"store_id" text,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"approver" text,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "os"."client_audit_log" ADD CONSTRAINT "client_audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."client_audit_log" ADD CONSTRAINT "client_audit_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "os"."client_audit_log" ADD CONSTRAINT "client_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "os"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_audit_log_client_created_idx" ON "os"."client_audit_log" USING btree ("client_id","created_at");
--> statement-breakpoint
CREATE INDEX "client_audit_log_store_idx" ON "os"."client_audit_log" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "client_audit_log_approver_idx" ON "os"."client_audit_log" USING btree ("approver");
--> statement-breakpoint
CREATE INDEX "client_audit_log_module_idx" ON "os"."client_audit_log" USING btree ("module");
--> statement-breakpoint
CREATE INDEX "client_audit_log_action_idx" ON "os"."client_audit_log" USING btree ("action");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "os"."reject_client_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'client_audit_log is append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "client_audit_log_no_update"
  BEFORE UPDATE ON "os"."client_audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION "os"."reject_client_audit_log_mutation"();
--> statement-breakpoint
CREATE TRIGGER "client_audit_log_no_delete"
  BEFORE DELETE ON "os"."client_audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION "os"."reject_client_audit_log_mutation"();
--> statement-breakpoint
CREATE TRIGGER "client_audit_log_no_truncate"
  BEFORE TRUNCATE ON "os"."client_audit_log"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "os"."reject_client_audit_log_mutation"();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "os"."client_audit_log" FROM PUBLIC;
