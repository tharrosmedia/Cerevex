import { inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ADS_DB_SCHEMA } from "@cerevex/contracts";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { clients } from "@tharros/ads-shared/schema";

loadEnv();

const REQUIRED_TABLES = [
  "workspaces",
  "users",
  "memberships",
  "clients",
  "client_memberships",
  "ad_accounts",
  "recommendations",
  "decisions",
  "authorizations",
  "apply_jobs",
  "audit_log",
  "audit_runs",
  "findings",
  "brainstorm_sessions",
  "brainstorm_ideas",
  "workflows",
  "workflow_runs",
  "oauth_credentials",
  "oauth_pending_connections",
  "ad_entities",
  "ad_metrics",
  "analytics_connections",
  "funnel_events",
  "lp_snapshots",
  "skill_client_configs",
  "skill_store_configs",
  "locations",
  "client_audit_log",
  "usage_events",
  "usage_counters",
];

describe("M1 core schema", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("creates every required and stub table", async () => {
    const db = getDb();
    const result = await db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = ${ADS_DB_SCHEMA}
    `);
    const names = new Set(
      (result.rows as { table_name: string }[]).map((row) => row.table_name),
    );
    for (const table of REQUIRED_TABLES) {
      expect(names.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it("keeps workspace_id on business tables and audit_log", async () => {
    const db = getDb();
    const result = await db.execute(sql`
      select table_name
      from information_schema.columns
      where table_schema = ${ADS_DB_SCHEMA}
        and column_name = 'workspace_id'
    `);
    const withWorkspace = new Set(
      (result.rows as { table_name: string }[]).map((row) => row.table_name),
    );
    for (const table of [
      "clients",
      "ad_accounts",
      "ad_entities",
      "ad_metrics",
      "recommendations",
      "decisions",
      "authorizations",
      "apply_jobs",
      "audit_log",
      "usage_events",
      "usage_counters",
    ]) {
      expect(withWorkspace.has(table), `${table} missing workspace_id`).toBe(true);
    }
  });

  it("stores last_error and frozen on ad_accounts", async () => {
    const db = getDb();
    const result = await db.execute(sql`
      select column_name
      from information_schema.columns
      where table_schema = ${ADS_DB_SCHEMA}
        and table_name = 'ad_accounts'
        and column_name in ('last_error', 'frozen')
    `);
    const names = new Set((result.rows as { column_name: string }[]).map((row) => row.column_name));
    expect(names.has("last_error")).toBe(true);
    expect(names.has("frozen")).toBe(true);
  });

  it("stores a paid-by-default plan and an active-location table", async () => {
    const db = getDb();
    const columns = await db.execute(sql`
      select column_name, column_default
      from information_schema.columns
      where table_schema = ${ADS_DB_SCHEMA}
        and table_name = 'clients'
        and column_name = 'plan'
    `);
    const plan = (columns.rows as { column_name: string; column_default: string | null }[])[0];
    expect(plan?.column_name).toBe("plan");
    expect(plan?.column_default ?? "").toContain("paid");

    const kill = await db.execute(sql`
      select column_default
      from information_schema.columns
      where table_schema = ${ADS_DB_SCHEMA}
        and table_name = 'workspaces'
        and column_name = 'apply_kill_switch'
    `);
    expect(String((kill.rows[0] as { column_default: string }).column_default)).toContain("true");

    const pilots = await db
      .select({ name: clients.name, plan: clients.plan })
      .from(clients)
      .where(inArray(clients.name, ["Got Ductless", "KC Prestige", "Elmar HVAC"]));
    expect(pilots).toHaveLength(3);
    expect(pilots.every((row) => row.plan === "paid")).toBe(true);
  });
});
