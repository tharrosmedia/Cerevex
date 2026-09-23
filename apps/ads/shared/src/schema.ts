import { ADS_DB_SCHEMA } from "@cerevex/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Isolated Cerevex ads schema. Postgres name stays `os` (ADS_DB_SCHEMA).
 * Never Brain public / pgvector. Do not ALTER SCHEMA.
 */
export const osSchema = pgSchema(ADS_DB_SCHEMA);
export const adsSchema = osSchema;

export const appRoleEnum = osSchema.enum("app_role", ["owner", "operator", "client_readonly"]);
export const platformEnum = osSchema.enum("platform", ["meta", "google"]);
export const decisionActionEnum = osSchema.enum("decision_action", ["authorize", "deny", "snooze"]);

export const workspaces = osSchema.table(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    settingsJson: jsonb("settings_json").notNull().default({}),
    applyKillSwitch: boolean("apply_kill_switch").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("workspaces_name_idx").on(table.name)],
);

export const users = osSchema.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const memberships = osSchema.table(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: appRoleEnum("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.workspaceId] }),
    index("memberships_workspace_idx").on(table.workspaceId),
  ],
);

export const clients = osSchema.table(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pilotFlag: boolean("pilot_flag").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("clients_workspace_idx").on(table.workspaceId),
    uniqueIndex("clients_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const clientMemberships = osSchema.table(
  "client_memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    role: appRoleEnum("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.clientId] }),
    index("client_memberships_client_idx").on(table.clientId),
  ],
);

export const adAccounts = osSchema.table(
  "ad_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    connectionStatus: text("connection_status").notNull().default("disconnected"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    frozen: boolean("frozen").notNull().default(false),
    scopesJson: jsonb("scopes_json").notNull().default([]),
  },
  (table) => [
    index("ad_accounts_client_idx").on(table.clientId),
    index("ad_accounts_workspace_idx").on(table.workspaceId),
    uniqueIndex("ad_accounts_client_platform_external_idx").on(
      table.clientId,
      table.platform,
      table.externalId,
    ),
  ],
);

export const recommendations = osSchema.table(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    estimatedImpactUsd: numeric("estimated_impact_usd", { precision: 12, scale: 2 }),
    risk: text("risk").notNull().default("medium"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    evidenceJson: jsonb("evidence_json").notNull().default({}),
    proposedMutationsJson: jsonb("proposed_mutations_json").notNull().default([]),
    status: text("status").notNull().default("proposed"),
    schemaVersion: text("schema_version").notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recommendations_client_idx").on(table.clientId),
    index("recommendations_workspace_idx").on(table.workspaceId),
    index("recommendations_ad_account_idx").on(table.adAccountId),
  ],
);

export const decisions = osSchema.table(
  "decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    action: decisionActionEnum("action").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("decisions_client_idx").on(table.clientId),
    index("decisions_recommendation_idx").on(table.recommendationId),
  ],
);

export const authorizations = osSchema.table(
  "authorizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    scopeJson: jsonb("scope_json").notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("authorizations_client_idx").on(table.clientId),
    index("authorizations_recommendation_idx").on(table.recommendationId),
  ],
);

export const applyJobs = osSchema.table(
  "apply_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    authorizationId: uuid("authorization_id")
      .notNull()
      .references(() => authorizations.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    requestJson: jsonb("request_json").notNull().default({}),
    responseJson: jsonb("response_json"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("apply_jobs_client_idx").on(table.clientId),
    index("apply_jobs_authorization_idx").on(table.authorizationId),
    uniqueIndex("apply_jobs_idempotency_idx").on(table.idempotencyKey),
  ],
);

export const auditLog = osSchema.table(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    payloadJson: jsonb("payload_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_workspace_idx").on(table.workspaceId),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const auditRuns = osSchema.table(
  "audit_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("stub"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summaryJson: jsonb("summary_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_runs_workspace_idx").on(table.workspaceId)],
);

export const findings = osSchema.table(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    auditRunId: uuid("audit_run_id").references(() => auditRuns.id, { onDelete: "cascade" }),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    bodyJson: jsonb("body_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("findings_workspace_idx").on(table.workspaceId)],
);

export const brainstormSessions = osSchema.table(
  "brainstorm_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("stub"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("brainstorm_sessions_workspace_idx").on(table.workspaceId)],
);

export const brainstormIdeas = osSchema.table(
  "brainstorm_ideas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => brainstormSessions.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    bodyJson: jsonb("body_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("brainstorm_ideas_session_idx").on(table.sessionId)],
);

export const workflows = osSchema.table(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definitionJson: jsonb("definition_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workflows_workspace_idx").on(table.workspaceId)],
);

export const workflowRuns = osSchema.table(
  "workflow_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("stub"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("workflow_runs_workflow_idx").on(table.workflowId)],
);

export const oauthCredentials = osSchema.table(
  "oauth_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    label: text("label").notNull().default("unconfigured"),
    encryptedPayload: text("encrypted_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("oauth_credentials_workspace_idx").on(table.workspaceId),
    index("oauth_credentials_ad_account_idx").on(table.adAccountId),
  ],
);

export const adEntities = osSchema.table(
  "ad_entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    parentExternalId: text("parent_external_id"),
    rawJson: jsonb("raw_json").notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ad_entities_account_idx").on(table.adAccountId),
    index("ad_entities_client_idx").on(table.clientId),
    uniqueIndex("ad_entities_account_type_external_idx").on(
      table.adAccountId,
      table.entityType,
      table.externalId,
    ),
  ],
);

export const analyticsConnections = osSchema.table(
  "analytics_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    connectorId: text("connector_id").notNull(),
    status: text("status").notNull().default("disconnected"),
    label: text("label").notNull().default("Funnel"),
    pixelToken: text("pixel_token"),
    settingsJson: jsonb("settings_json").notNull().default({}),
    lastError: text("last_error"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analytics_connections_workspace_idx").on(table.workspaceId),
    uniqueIndex("analytics_connections_workspace_connector_client_idx").on(
      table.workspaceId,
      table.connectorId,
      table.clientId,
    ),
  ],
);

export const funnelEvents = osSchema.table(
  "funnel_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => analyticsConnections.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    source: text("source").notNull().default("first_party"),
    url: text("url"),
    referrer: text("referrer"),
    platform: text("platform"),
    campaign: text("campaign"),
    clickId: text("click_id"),
    propertiesJson: jsonb("properties_json").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("funnel_events_workspace_idx").on(table.workspaceId),
    index("funnel_events_occurred_idx").on(table.occurredAt),
    index("funnel_events_name_idx").on(table.name),
  ],
);

export const lpSnapshots = osSchema.table(
  "lp_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    headline: text("headline"),
    bodyText: text("body_text"),
    offerText: text("offer_text"),
    rawJson: jsonb("raw_json").notNull().default({}),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lp_snapshots_workspace_idx").on(table.workspaceId),
    index("lp_snapshots_url_idx").on(table.url),
  ],
);

export const adMetrics = osSchema.table(
  "ad_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => adEntities.id, { onDelete: "cascade" }),
    window: text("window").notNull(),
    spendUsd: numeric("spend_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    conversions: numeric("conversions", { precision: 12, scale: 2 }).notNull().default("0"),
    rawJson: jsonb("raw_json").notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ad_metrics_account_idx").on(table.adAccountId),
    uniqueIndex("ad_metrics_entity_window_idx").on(table.entityId, table.window),
  ],
);
