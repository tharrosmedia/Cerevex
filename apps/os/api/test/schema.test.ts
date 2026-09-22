import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "@tharros/shared";
import { closeDb, getDb } from "@tharros/shared/db";

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
  "ad_entities",
  "ad_metrics",
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
      where table_schema = 'os'
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
      where table_schema = 'os'
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
    ]) {
      expect(withWorkspace.has(table), `${table} missing workspace_id`).toBe(true);
    }
  });

  it("stores last_error on ad_accounts", async () => {
    const db = getDb();
    const result = await db.execute(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'os'
        and table_name = 'ad_accounts'
        and column_name = 'last_error'
    `);
    expect(result.rows.length).toBe(1);
  });
});
