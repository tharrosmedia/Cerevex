import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SkillJobApprovalError } from "@cerevex/skills";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb, getPool } from "@tharros/ads-shared/db";
import { parseRecommendationDraft } from "@tharros/ads-shared/audit-schemas";
import { createApplyJobForAuthorization, decideRecommendation } from "@tharros/ads-shared/audit";
import { runApplyJob } from "@tharros/ads-shared/apply";
import {
  csvCell,
  insertJobRecommendation,
  listClientAuditLog,
  recordRecLifecycle,
} from "@tharros/ads-shared/rec-lifecycle";
import { clientAuditLog, memberships, recommendations, users, workspaces } from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

function draftFor(input: { workspaceId: string; clientId: string; adAccountId: string }) {
  return parseRecommendationDraft({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    adAccountId: input.adAccountId,
    type: "pause_waste",
    title: "Pause a wasted ad",
    rationale: "Spend without a qualified outcome.",
    estimatedImpactUsd: null,
    risk: "low",
    confidence: null,
    evidenceJson: {
      auditRunId: randomUUID(),
      ruleId: "client_audit_test",
      writes: false,
    },
    proposedMutationsJson: [
      {
        platform: "meta",
        action: "pause",
        target: { entityType: "ad", externalId: "ad-1", name: "Ad" },
        payload: { accessToken: "should-not-leak", note: "before" },
        execute: false,
      },
    ],
    status: "proposed",
    schemaVersion: "1",
  });
}

describe("client audit log", () => {
  let ownerToken = "";
  let clientId = "";
  let workspaceId = "";
  let accountId = "";
  let ownerId = "";

  beforeAll(async () => {
    await ensureScopedUser();
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("workspace missing");
    expect(workspace.applyKillSwitch).toBe(true);
    workspaceId = workspace.id;
    const owner = await db.query.users.findFirst({
      where: eq(users.email, process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com"),
    });
    if (!owner) throw new Error("owner missing");
    ownerId = owner.id;
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${ownerToken}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    clientId = clients.find((row) => row.name === "Got Ductless")?.id ?? "";
    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "meta" }),
    });
    accountId = String(((await json(connect)).adAccount as { id: string }).id);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("escapes CSV formula prefixes", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("hello, there")).toBe('"hello, there"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("refuses a job or skill that tries to set approved", async () => {
    const db = getDb();
    const before = await db.select({ id: recommendations.id }).from(recommendations);
    await expect(
      insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
        source: "native:audit",
        approval: { status: "approved", approved_by: "a job", executed_by: "cerevex_apply" },
      }),
    ).rejects.toBeInstanceOf(SkillJobApprovalError);
    const after = await db.select({ id: recommendations.id }).from(recommendations);
    expect(after).toHaveLength(before.length);
  });

  it("writes each event from its path and keeps the kill switch on", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
      storeId: "store-got-ductless",
    });
    expect(created.approvalJson).toMatchObject({ status: "PENDING_APPROVAL", executed_by: null });

    const unauth = await app.request(`/clients/${clientId}/audit-log`);
    expect(unauth.status).toBe(401);

    const approved = await decideRecommendation({
      recommendationId: created.id,
      userId: ownerId,
      action: "authorize",
    });
    expect(approved.recommendation.approval.status).toBe("approved");
    expect(approved.recommendation.approval.approved_by).toBeTruthy();
    expect(approved.recommendation.approval.executed_by).toBeNull();

    const blockedApprove = await app.request(`/recommendations/${created.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(blockedApprove.status).toBe(409);

    const authorizationId = approved.authorization?.id;
    expect(authorizationId).toBeTruthy();
    const job = await createApplyJobForAuthorization({
      workspaceId,
      clientId,
      authorizationId: authorizationId!,
      recommendationId: created.id,
      proposedMutations: created.proposedMutationsJson,
    });
    const ran = await runApplyJob(job.id);
    expect(ran.writes).toBe(false);
    expect(ran.blocked).toBeTruthy();

    const applied = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
    expect(applied?.approvalJson).toMatchObject({
      status: "approved",
      executed_by: "cerevex_apply",
    });
    expect(String((applied?.approvalJson as { apply_result?: string }).apply_result)).toMatch(/^error:/);

    const deniedDraft = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "agent:test",
      module: "paid-media",
    });
    const deny = await app.request(`/recommendations/${deniedDraft.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny" }),
    });
    expect(deny.status).toBe(200);
    const deniedBody = await json(deny);
    expect((deniedBody.recommendation as { approval: { status: string } }).approval.status).toBe("rejected");

    const manual = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    await decideRecommendation({ recommendationId: manual.id, userId: ownerId, action: "authorize" });
    const marked = await app.request(`/recommendations/${manual.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_done" }),
    });
    expect(marked.status).toBe(200);
    const markedBody = await json(marked);
    expect((markedBody.recommendation as { approval: { executed_by: string } }).approval.executed_by).toBe("human");

    const rolled = await app.request(`/recommendations/${created.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "rollback" }),
    });
    expect(rolled.status).toBe(200);

    const layer = await app.request("/recommendations/lifecycle", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "prompt_layer_approved",
        clientId,
        version: "hvac-usa@v1",
        storeId: "store-got-ductless",
      }),
    });
    expect(layer.status).toBe(200);
    const layerBack = await app.request("/recommendations/lifecycle", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "prompt_layer_rolled_back",
        clientId,
        version: "hvac-usa@v1",
      }),
    });
    expect(layerBack.status).toBe(200);

    const email = "audit-role@tharrosmedia.com";
    const passwordHash = await hash("role-local-only", 10);
    const db = getDb();
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const roleUser =
      existing ??
      (await db.insert(users).values({ email, name: "Audit Role", passwordHash }).returning())[0];
    await db
      .insert(memberships)
      .values({ userId: roleUser.id, workspaceId, role: "operator" })
      .onConflictDoNothing();
    await db
      .update(memberships)
      .set({ role: "operator" })
      .where(eq(memberships.userId, roleUser.id));
    const roleRes = await app.request("/memberships/role", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: roleUser.id, workspaceId, role: "client_readonly" }),
    });
    expect(roleRes.status).toBe(200);

    const formulaEmail = "formula@tharrosmedia.com";
    const formulaExisting = await db.query.users.findFirst({ where: eq(users.email, formulaEmail) });
    const formulaUser =
      formulaExisting ??
      (
        await db
          .insert(users)
          .values({ email: formulaEmail, name: "=1+1", passwordHash })
          .returning()
      )[0];
    if (formulaExisting && formulaExisting.name !== "=1+1") {
      await db.update(users).set({ name: "=1+1" }).where(eq(users.id, formulaUser.id));
    }
    await recordRecLifecycle({
      kind: "prompt_layer_rolled_back",
      workspaceId,
      clientId,
      storeId: "-store",
      module: "@ads",
      actorType: "user",
      actorId: formulaUser.id,
      entityType: "prompt_layer",
      version: "+layer",
    });

    const listed = await listClientAuditLog({ clientId, limit: 100 });
    const actions = new Set(listed.rows.map((row) => row.action));
    for (const action of [
      "rec_created",
      "approved",
      "rejected",
      "applied",
      "mark_done",
      "rolled_back",
      "prompt_layer_approved",
      "prompt_layer_rolled_back",
      "role_changed",
    ]) {
      expect(actions.has(action), action).toBe(true);
    }

    const byModule = await listClientAuditLog({ clientId, module: "prompt-layer", limit: 100 });
    expect(byModule.rows.length).toBeGreaterThan(0);
    expect(byModule.rows.every((row) => row.module === "prompt-layer")).toBe(true);
    const byStore = await listClientAuditLog({ clientId, storeId: "store-got-ductless", limit: 100 });
    expect(byStore.rows.every((row) => row.storeId === "store-got-ductless")).toBe(true);
    const byApprover = await listClientAuditLog({ clientId, approver: "=1+1", limit: 100 });
    expect(byApprover.rows.length).toBeGreaterThan(0);
    const byAction = await listClientAuditLog({ clientId, action: "role_changed", limit: 100 });
    expect(byAction.rows.every((row) => row.action === "role_changed")).toBe(true);
    const future = await listClientAuditLog({ clientId, from: "2099-01-01", to: "2099-01-02" });
    expect(future.rows).toHaveLength(0);

    const exported = await app.request(`/clients/${clientId}/audit-log/export?format=json&approver=${encodeURIComponent("=1+1")}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(exported.status).toBe(200);
    const jsonBody = (await exported.json()) as { rows: { approver: string; payload: { version?: string } }[]; truncated: boolean; limit: number };
    expect(jsonBody.truncated).toBe(false);
    expect(jsonBody.limit).toBe(2000);
    expect(jsonBody.rows[0]?.approver).toBe("=1+1");
    expect(JSON.stringify(jsonBody)).not.toContain("should-not-leak");

    const csvRes = await app.request(
      `/clients/${clientId}/audit-log/export?format=csv&approver=${encodeURIComponent("=1+1")}`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csv = await csvRes.text();
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'-store");
    expect(csv).toContain("'@ads");
    expect(csv).toContain("+layer");
    expect(csv.startsWith("created_at,")).toBe(true);
    const appliedEvents = await listClientAuditLog({ clientId, action: "applied", limit: 100 });
    expect(JSON.stringify(appliedEvents.rows)).not.toContain("should-not-leak");
    expect(JSON.stringify(appliedEvents.rows)).toContain("[redacted]");

    const paused = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const killSwitch = await app.request(`/recommendations/${paused.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(killSwitch.status).toBe(409);
    const killBody = await json(killSwitch);
    expect(String(killBody.error)).toMatch(/paused/i);

    const sample = listed.rows[0];
    expect(sample).toBeTruthy();
    const pool = getPool();
    await expect(
      pool.query(`update os.client_audit_log set action = 'tampered' where id = $1`, [sample!.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`delete from os.client_audit_log where id = $1`, [sample!.id]),
    ).rejects.toThrow(/append-only/);
    const still = await getDb().query.clientAuditLog.findFirst({ where: eq(clientAuditLog.id, sample!.id) });
    expect(still?.action).toBe(sample!.action);
  });
});
