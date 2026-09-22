CREATE SCHEMA IF NOT EXISTS "os";--> statement-breakpoint
CREATE TYPE "os"."app_role" AS ENUM('owner', 'operator', 'client_readonly');--> statement-breakpoint
CREATE TYPE "os"."decision_action" AS ENUM('authorize', 'deny', 'snooze');--> statement-breakpoint
CREATE TYPE "os"."platform" AS ENUM('meta', 'google');--> statement-breakpoint
CREATE TABLE "os"."ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"connection_status" text DEFAULT 'disconnected' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."apply_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"authorization_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"request_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_json" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "os"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"status" text DEFAULT 'stub' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"scope_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "os"."brainstorm_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"body_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."brainstorm_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'stub' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."client_memberships" (
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	CONSTRAINT "client_memberships_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "os"."clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pilot_flag" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "decision_action" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"audit_run_id" uuid,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."memberships" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	CONSTRAINT "memberships_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "os"."oauth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"platform" "platform" NOT NULL,
	"label" text DEFAULT 'unconfigured' NOT NULL,
	"encrypted_payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"estimated_impact_usd" numeric(12, 2),
	"risk" text DEFAULT 'medium' NOT NULL,
	"confidence" numeric(5, 4),
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_mutations_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"schema_version" text DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"status" text DEFAULT 'stub' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "os"."workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"definition_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"apply_kill_switch" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "os"."ad_accounts" ADD CONSTRAINT "ad_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."ad_accounts" ADD CONSTRAINT "ad_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."apply_jobs" ADD CONSTRAINT "apply_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."apply_jobs" ADD CONSTRAINT "apply_jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."apply_jobs" ADD CONSTRAINT "apply_jobs_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "os"."authorizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."audit_runs" ADD CONSTRAINT "audit_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."audit_runs" ADD CONSTRAINT "audit_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."authorizations" ADD CONSTRAINT "authorizations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."authorizations" ADD CONSTRAINT "authorizations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."authorizations" ADD CONSTRAINT "authorizations_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "os"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."authorizations" ADD CONSTRAINT "authorizations_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "os"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."brainstorm_ideas" ADD CONSTRAINT "brainstorm_ideas_session_id_brainstorm_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "os"."brainstorm_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."brainstorm_ideas" ADD CONSTRAINT "brainstorm_ideas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."brainstorm_ideas" ADD CONSTRAINT "brainstorm_ideas_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."brainstorm_sessions" ADD CONSTRAINT "brainstorm_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."brainstorm_sessions" ADD CONSTRAINT "brainstorm_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."client_memberships" ADD CONSTRAINT "client_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "os"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."client_memberships" ADD CONSTRAINT "client_memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."decisions" ADD CONSTRAINT "decisions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."decisions" ADD CONSTRAINT "decisions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "os"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."decisions" ADD CONSTRAINT "decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "os"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."findings" ADD CONSTRAINT "findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."findings" ADD CONSTRAINT "findings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."findings" ADD CONSTRAINT "findings_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "os"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "os"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."oauth_credentials" ADD CONSTRAINT "oauth_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."oauth_credentials" ADD CONSTRAINT "oauth_credentials_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."recommendations" ADD CONSTRAINT "recommendations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."recommendations" ADD CONSTRAINT "recommendations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."recommendations" ADD CONSTRAINT "recommendations_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "os"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "os"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."workflow_runs" ADD CONSTRAINT "workflow_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."workflows" ADD CONSTRAINT "workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "os"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os"."workflows" ADD CONSTRAINT "workflows_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "os"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_accounts_client_idx" ON "os"."ad_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "ad_accounts_workspace_idx" ON "os"."ad_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_client_platform_external_idx" ON "os"."ad_accounts" USING btree ("client_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "apply_jobs_client_idx" ON "os"."apply_jobs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "apply_jobs_authorization_idx" ON "os"."apply_jobs" USING btree ("authorization_id");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_idx" ON "os"."audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "os"."audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_runs_workspace_idx" ON "os"."audit_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "authorizations_client_idx" ON "os"."authorizations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "authorizations_recommendation_idx" ON "os"."authorizations" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "brainstorm_ideas_session_idx" ON "os"."brainstorm_ideas" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "brainstorm_sessions_workspace_idx" ON "os"."brainstorm_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "client_memberships_client_idx" ON "os"."client_memberships" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_workspace_idx" ON "os"."clients" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_workspace_name_idx" ON "os"."clients" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "decisions_client_idx" ON "os"."decisions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "decisions_recommendation_idx" ON "os"."decisions" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "findings_workspace_idx" ON "os"."findings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "memberships_workspace_idx" ON "os"."memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "oauth_credentials_workspace_idx" ON "os"."oauth_credentials" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "recommendations_client_idx" ON "os"."recommendations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "recommendations_workspace_idx" ON "os"."recommendations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "recommendations_ad_account_idx" ON "os"."recommendations" USING btree ("ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "os"."users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "os"."workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflows_workspace_idx" ON "os"."workflows" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_name_idx" ON "os"."workspaces" USING btree ("name");--> statement-breakpoint
CREATE RULE audit_log_no_update AS ON UPDATE TO "os"."audit_log" DO INSTEAD NOTHING;--> statement-breakpoint
CREATE RULE audit_log_no_delete AS ON DELETE TO "os"."audit_log" DO INSTEAD NOTHING;