import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { SkillJobApprovalError } from "@cerevex/skills";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb, getPool } from "@tharros/ads-shared/db";
import { parseRecommendationDraft } from "@tharros/ads-shared/audit-schemas";
import { createApplyJobForAuthorization, decideRecommendation } from "@tharros/ads-shared/audit";
import { runApplyJob } from "@tharros/ads-shared/apply";
import {
  countClientAuditLog,
  csvCell,
  insertJobRecommendation,
  listClientAuditLog,
  readApproval,
  recordRecLifecycle,
  redactAuditValue,
} from "@tharros/ads-shared/rec-lifecycle";
import { activateStore, deactivateStore, EntitlementError, setClientPlan } from "@tharros/ads-shared/entitlements";
import { applyJobs, authorizations, clientAuditLog, clients, memberships, recommendations, users, workspaces } from "@tharros/ads-shared/schema";
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

  it("scrubs compact phones, international numbers, and obfuscated emails", () => {
    const scrubbed = redactAuditValue({
      note: "call 5551234567 or +44 20 7946 0958, write ada [at] example [dot] com",
    }) as { note: string };
    expect(scrubbed.note).not.toContain("5551234567");
    expect(scrubbed.note).not.toContain("+44");
    expect(scrubbed.note).not.toContain("[at]");
    expect(scrubbed.note).not.toContain("example");
    expect(scrubbed.note).toContain("[redacted]");
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

    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    let approved: Awaited<ReturnType<typeof decideRecommendation>>;
    try {
      approved = await decideRecommendation({
        recommendationId: created.id,
        userId: ownerId,
        action: "authorize",
      });
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
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
    const blockedApproval = readApproval(applied?.approvalJson);
    expect(blockedApproval.status).toBe("approved");
    expect(blockedApproval.executed_by).toBeNull();
    expect(blockedApproval.executed_at).toBeNull();
    const blockedEvents = await listClientAuditLog({ clientId, action: "apply_blocked", limit: 100 });
    expect(blockedEvents.rows.some((row) => row.entityId === created.id)).toBe(true);
    expect(JSON.stringify(blockedEvents.rows)).not.toContain("should-not-leak");
    expect(JSON.stringify(blockedEvents.rows)).toContain("[redacted]");

    const beforeRetry = await countClientAuditLog(clientId);
    await getDb().update(applyJobs).set({ status: "succeeded" }).where(eq(applyJobs.id, job.id));
    const retried = await runApplyJob(job.id);
    expect(retried.fresh).toBe(false);
    expect(await countClientAuditLog(clientId)).toBe(beforeRetry);

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
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    try {
      await decideRecommendation({ recommendationId: manual.id, userId: ownerId, action: "authorize" });
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
    const marked = await app.request(`/recommendations/${manual.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_done" }),
    });
    expect(marked.status).toBe(200);
    const markedBody = await json(marked);
    expect((markedBody.recommendation as { approval: { executed_by: string } }).approval.executed_by).toBe("human");

    const rolledBlocked = await app.request(`/recommendations/${created.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "rollback" }),
    });
    expect(rolledBlocked.status).toBe(409);
    const rolled = await app.request(`/recommendations/${manual.id}/decide`, {
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
        note: "reach ada@example.com or 555-123-4567",
      }),
    });
    expect(layer.status).toBe(200);
    const layerBody = await json(layer);
    const layerPayload = JSON.stringify(layerBody);
    expect(layerPayload).not.toContain("ada@example.com");
    expect(layerPayload).not.toContain("555-123-4567");
    expect(layerPayload).toContain("[redacted]");
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
      "apply_blocked",
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
    const appliedEvents = await listClientAuditLog({ clientId, action: "apply_blocked", limit: 100 });
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
    const refusals = await listClientAuditLog({ clientId, action: "approve_refused", limit: 100 });
    expect(refusals.rows.some((row) => row.entityId === paused.id && JSON.stringify(row.payload).includes("apply_kill_switch"))).toBe(true);

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

    const countBefore = await countClientAuditLog(clientId);
    await expectTruncateRefused("TRUNCATE os.client_audit_log");
    await expectTruncateRefused("TRUNCATE os.workspaces CASCADE");
    await expectTruncateRefusedAsGrantee();
    expect(await countClientAuditLog(clientId)).toBe(countBefore);
  });

  it("refuses person lifecycle events from the service key and writes no audit row", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const before = await countClientAuditLog(clientId);
    const db = getDb();
    const extraEmail = "service-key-extra-owner@example.com";
    const extraHash = await hash("service-key-extra-only", 10);
    const extraExisting = await db.query.users.findFirst({ where: eq(users.email, extraEmail) });
    const extraUser =
      extraExisting ??
      (await db.insert(users).values({ email: extraEmail, name: "Service Key Extra", passwordHash: extraHash }).returning())[0];
    const extraWorkspace =
      (await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Service Key Extra Workspace") })) ??
      (await db.insert(workspaces).values({ name: "Service Key Extra Workspace" }).returning())[0];
    await db
      .insert(memberships)
      .values({ userId: extraUser.id, workspaceId: extraWorkspace.id, role: "owner" })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.workspaceId],
        set: { role: "owner" },
      });
    const displaced = await db
      .select({ userId: memberships.userId, workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(and(eq(memberships.role, "owner"), ne(memberships.userId, ownerId)));
    if (displaced.length > 0) {
      await db
        .update(memberships)
        .set({ role: "operator" })
        .where(and(eq(memberships.role, "owner"), ne(memberships.userId, ownerId)));
    }
    const previousKey = process.env.ADS_INTERNAL_KEY;
    process.env.ADS_INTERNAL_KEY = "audit-service-key";
    try {
      const bodies = [
        { kind: "approved", clientId, recommendationId: created.id },
        { kind: "mark_done", clientId, recommendationId: created.id },
        { kind: "rolled_back", clientId, recommendationId: created.id },
        { kind: "prompt_layer_approved", clientId, version: "forged@v99" },
      ];
      for (const body of bodies) {
        const res = await app.request("/recommendations/lifecycle", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-cerevex-internal-key": "audit-service-key",
          },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(403);
      }
    } finally {
      if (previousKey === undefined) delete process.env.ADS_INTERNAL_KEY;
      else process.env.ADS_INTERNAL_KEY = previousKey;
      for (const row of displaced) {
        await db
          .update(memberships)
          .set({ role: "owner" })
          .where(and(eq(memberships.userId, row.userId), eq(memberships.workspaceId, row.workspaceId)));
      }
    }
    expect(await countClientAuditLog(clientId)).toBe(before);
    const rec = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
    expect(readApproval(rec?.approvalJson).status).toBe("PENDING_APPROVAL");
    expect(rec?.status).toBe("proposed");
    const forged = await listClientAuditLog({ clientId, action: "prompt_layer_approved", limit: 100 });
    expect(JSON.stringify(forged.rows)).not.toContain("forged@v99");
  });

  it("returns 404 and writes no audit row for another workspace", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const email = "other-workspace-audit@example.com";
    const password = "other-workspace-only";
    const passwordHash = await hash(password, 10);
    const db = getDb();
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const outsider =
      existing ??
      (await db.insert(users).values({ email, name: "Other Workspace", passwordHash }).returning())[0];
    if (existing) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, outsider.id));
    }
    const workspace =
      (await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Other Audit Workspace") })) ??
      (await db.insert(workspaces).values({ name: "Other Audit Workspace" }).returning())[0];
    await db
      .insert(memberships)
      .values({ userId: outsider.id, workspaceId: workspace.id, role: "owner" })
      .onConflictDoNothing();
    const ownClient =
      (await db.query.clients.findFirst({ where: eq(clients.workspaceId, workspace.id) })) ??
      (await db.insert(clients).values({ workspaceId: workspace.id, name: "Other Audit Client" }).returning())[0];
    expect(ownClient.workspaceId).not.toBe(workspaceId);
    const outsiderToken = (await login(email, password)).token;
    const before = await countClientAuditLog(clientId);
    const missing = "11111111-1111-4111-8111-111111111111";
    for (const [path, body] of [
      [`/recommendations/${created.id}/decide`, { action: "mark_done" }],
      [`/recommendations/${created.id}/decide`, { action: "rollback" }],
      [`/recommendations/${created.id}/decide`, { action: "deny" }],
      [`/recommendations/${created.id}/apply`, {}],
      [`/recommendations/${missing}/decide`, { action: "mark_done" }],
    ] as const) {
      const res = await app.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${outsiderToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(404);
    }
    expect(await countClientAuditLog(clientId)).toBe(before);
    const rec = await db.query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
    expect(rec?.status).toBe("proposed");
  });

  it("refuses to approve a snoozed recommendation through the lifecycle route", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    await decideRecommendation({ recommendationId: created.id, userId: ownerId, action: "snooze" });
    const before = await countClientAuditLog(clientId);
    const res = await app.request("/recommendations/lifecycle", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "approved", clientId, recommendationId: created.id }),
    });
    expect(res.status).toBe(409);
    const rec = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
    expect(rec?.status).toBe("snoozed");
    expect(readApproval(rec?.approvalJson).status).toBe("PENDING_APPROVAL");
    expect(await countClientAuditLog(clientId)).toBe(before);
  });

  it("refuses lifecycle approve and deny while the kill switch is on, then approves once through decide", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const before = await countClientAuditLog(clientId);
    for (const kind of ["approved", "rejected"] as const) {
      const res = await app.request("/recommendations/lifecycle", {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ kind, clientId, recommendationId: created.id }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    const held = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
    expect(held?.status).toBe("proposed");
    expect(readApproval(held?.approvalJson).status).toBe("PENDING_APPROVAL");
    expect(await countClientAuditLog(clientId)).toBe(before);
    expect(await authorizationCount(created.id)).toBe(0);

    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    try {
      const decide = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(decide.status).toBe(200);
      const after = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
      expect(after?.status).toBe("authorized");
      expect(readApproval(after?.approvalJson).status).toBe("approved");
      expect(await authorizationCount(created.id)).toBe(1);
      const approvedRows = await listClientAuditLog({ clientId, action: "approved", limit: 100 });
      expect(approvedRows.rows.filter((row) => row.entityId === created.id)).toHaveLength(1);
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
  });

  it("redacts paren phones, obfuscated emails, percent-encoded at, and full-width digits", () => {
    const scrubbed = redactAuditValue({
      note: "call (555)123-4567, ada(at)example(dot)com, ada%40example.com, ５５５１２３４５６７, keep 1760000000 and customers/9876543210 campaigns/2345678901",
      customerId: "9876543210",
      externalId: "1234567890",
      campaignId: "2345678901",
    }) as { note: string; customerId: string; externalId: string; campaignId: string };
    expect(scrubbed.note).not.toContain("(555)123-4567");
    expect(scrubbed.note).not.toContain("(at)");
    expect(scrubbed.note).not.toContain("%40");
    expect(scrubbed.note).not.toContain("５５５１２３４５６７");
    expect(scrubbed.note).not.toContain("5551234567");
    expect(scrubbed.note).toContain("[redacted]");
    expect(scrubbed.note).toContain("1760000000");
    expect(scrubbed.note).toContain("customers/9876543210");
    expect(scrubbed.note).toContain("campaigns/2345678901");
    expect(scrubbed.customerId).toBe("9876543210");
    expect(scrubbed.externalId).toBe("1234567890");
    expect(scrubbed.campaignId).toBe("2345678901");
  });

  it("redacts bare, international, dashed, and obfuscated phones and emails without eating ids", () => {
    const arabic = "\u0665\u0665\u0665\u0661\u0662\u0663\u0664\u0665\u0666\u0667";
    const eastern = "\u06F5\u06F5\u06F5\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7";
    const fullWidthId = "\uFF19\uFF18\uFF17\uFF16\uFF15\uFF14\uFF13\uFF12\uFF11\uFF10";
    const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-2234567890ab";
    const scrubbed = redactAuditValue({
      note: [
        "15551234567",
        "555-1234",
        "+44 (0)20 7946 0958",
        "0044 20 7946 0958",
        "020 7946 0958",
        "07700 900123",
        "+49 30/1234567",
        "555\u2013123\u20134567",
        "555\u2014123\u20144567",
        arabic,
        eastern,
        "ada [at] example.com",
        "ada {at} example.com",
        "ada at example dot com",
        "ADA AT EXAMPLE DOT COM",
        "ada @ x.com",
        "ada\uFF20x.com",
        "ada\uFE6Bx.com",
        `keep ${uuid}`,
        "keep 1760000000",
        "keep 1234567890",
        "keep customers/9876543210",
      ].join(" | "),
      customerId: "223-456-7890",
      externalId: fullWidthId,
      amountMicros: "5551234567",
      budgetMicros: "15551234567",
      customerIds: ["5551234567", "223-456-7890"],
      id: "555-123-4567",
      before: [
        {
          payload: {
            amountMicros: "5551234567",
            budgetMicros: "223456789012345",
            customerId: "223-456-7890",
            note: "call 5551234567",
          },
        },
      ],
    }) as {
      note: string;
      customerId: string;
      externalId: string;
      amountMicros: string;
      budgetMicros: string;
      customerIds: string[];
      id: string;
      before: Array<{ payload: { amountMicros: string; budgetMicros: string; customerId: string; note: string } }>;
    };

    for (const leaked of [
      "15551234567",
      "555-1234",
      "+44",
      "0044",
      "020 7946",
      "07700",
      "+49",
      "555\u2013123",
      "555\u2014123",
      arabic,
      eastern,
      "[at]",
      "{at}",
      " at ",
      " AT ",
      "@",
      "\uFF20",
      "\uFE6B",
      "5551234567",
    ]) {
      expect(scrubbed.note, leaked).not.toContain(leaked);
    }
    expect(scrubbed.note).toContain("[redacted]");
    expect(scrubbed.note).toContain(uuid);
    expect(scrubbed.note).toContain("1760000000");
    expect(scrubbed.note).toContain("1234567890");
    expect(scrubbed.note).toContain("customers/9876543210");
    expect(scrubbed.customerId).toBe("223-456-7890");
    expect(scrubbed.externalId).toBe(fullWidthId);
    expect(scrubbed.amountMicros).toBe("5551234567");
    expect(scrubbed.budgetMicros).toBe("15551234567");
    expect(scrubbed.customerIds).toEqual(["5551234567", "223-456-7890"]);
    expect(scrubbed.id).toBe("555-123-4567");
    expect(scrubbed.before[0]?.payload.amountMicros).toBe("5551234567");
    expect(scrubbed.before[0]?.payload.budgetMicros).toBe("223456789012345");
    expect(scrubbed.before[0]?.payload.customerId).toBe("223-456-7890");
    expect(scrubbed.before[0]?.payload.note).not.toContain("5551234567");
    expect(scrubbed.before[0]?.payload.note).toContain("[redacted]");
  });

  it("redacts a 40KB string quickly", () => {
    const blob = "a".repeat(40_000);
    const started = performance.now();
    const scrubbed = redactAuditValue(blob);
    expect(performance.now() - started).toBeLessThan(500);
    expect(scrubbed).toBe(blob);
  });

  it("locks the recommendation so concurrent approves write one authorization", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          app.request(`/recommendations/${created.id}/decide`, {
            method: "POST",
            headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
            body: JSON.stringify({ action: "approve" }),
          }),
        ),
      );
      const statuses = results.map((res) => res.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
      expect(await authorizationCount(created.id)).toBe(1);
      const approvedRows = await listClientAuditLog({ clientId, action: "approved", limit: 100 });
      expect(approvedRows.rows.filter((row) => row.entityId === created.id)).toHaveLength(1);
      const rec = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
      expect(rec?.status).toBe("authorized");
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
  });

  it("refuses a second mark_done and writes no extra audit row", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    try {
      const decide = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(decide.status).toBe(200);
      const first = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_done" }),
      });
      expect(first.status).toBe(200);
      const before = await countClientAuditLog(clientId);
      const second = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_done" }),
      });
      expect(second.status).toBe(409);
      const viaLifecycle = await app.request("/recommendations/lifecycle", {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "mark_done", clientId, recommendationId: created.id }),
      });
      expect(viaLifecycle.status).toBe(409);
      expect(await countClientAuditLog(clientId)).toBe(before);
      const marked = await listClientAuditLog({ clientId, action: "mark_done", limit: 100 });
      expect(marked.rows.filter((row) => row.entityId === created.id)).toHaveLength(1);
      const refusals = await listClientAuditLog({ clientId, action: "approve_refused", limit: 100 });
      expect(refusals.rows.some((row) => row.entityId === created.id)).toBe(false);
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
  });

  it("returns 400 for a malformed recommendation id on decide and apply", async () => {
    for (const path of ["/recommendations/not-a-uuid/decide", "/recommendations/not-a-uuid/apply"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("returns the same not-found response when a lifecycle rec is missing or hidden", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const outsiderToken = await outsiderTokenFor();
    const missing = "22222222-2222-4222-8222-222222222222";
    const missingRes = await app.request("/recommendations/lifecycle", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "mark_done", clientId, recommendationId: missing }),
    });
    const hiddenRes = await app.request("/recommendations/lifecycle", {
      method: "POST",
      headers: { authorization: `Bearer ${outsiderToken}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "mark_done", clientId, recommendationId: created.id }),
    });
    expect(missingRes.status).toBe(404);
    expect(hiddenRes.status).toBe(404);
    expect((await json(missingRes)).error).toBe("Not found");
    expect((await json(hiddenRes)).error).toBe("Not found");
  });

  it("lets one parallel mark_done win on decide and on lifecycle", async () => {
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    try {
      for (const path of ["decide", "lifecycle"] as const) {
        const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
          source: "native:paid-media",
          module: "paid-media",
        });
        const approved = await app.request(`/recommendations/${created.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        });
        expect(approved.status).toBe(200);
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            path === "decide"
              ? app.request(`/recommendations/${created.id}/decide`, {
                  method: "POST",
                  headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
                  body: JSON.stringify({ action: "mark_done" }),
                })
              : app.request("/recommendations/lifecycle", {
                  method: "POST",
                  headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
                  body: JSON.stringify({ kind: "mark_done", clientId, recommendationId: created.id }),
                }),
          ),
        );
        const statuses = results.map((res) => res.status);
        expect(statuses.filter((status) => status === 200), path).toHaveLength(1);
        expect(statuses.every((status) => status === 200 || status === 409), `${path} ${statuses.join(",")}`).toBe(true);
        const marked = await listClientAuditLog({ clientId, action: "mark_done", limit: 100 });
        expect(marked.rows.filter((row) => row.entityId === created.id), path).toHaveLength(1);
        const rec = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
        expect(rec?.status).toBe("authorized");
        expect(readApproval(rec?.approvalJson).executed_by).toBe("human");
      }
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
  });

  it("refuses a second rollback from decide and from lifecycle", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    try {
      const approved = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(approved.status).toBe(200);
      const marked = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_done" }),
      });
      expect(marked.status).toBe(200);
      const first = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "rollback" }),
      });
      expect(first.status).toBe(200);
      const before = await countClientAuditLog(clientId);
      const second = await app.request(`/recommendations/${created.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "rollback" }),
      });
      expect(second.status).toBe(409);
      const viaLifecycle = await app.request("/recommendations/lifecycle", {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "rolled_back", clientId, recommendationId: created.id }),
      });
      expect(viaLifecycle.status).toBe(409);
      expect(await countClientAuditLog(clientId)).toBe(before);
      const rolled = await listClientAuditLog({ clientId, action: "rolled_back", limit: 100 });
      expect(rolled.rows.filter((row) => row.entityId === created.id)).toHaveLength(1);
      const refusals = await listClientAuditLog({ clientId, action: "approve_refused", limit: 100 });
      expect(refusals.rows.some((row) => row.entityId === created.id && JSON.stringify(row.payload).includes("rollback"))).toBe(false);
    } finally {
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
  });

  it("mixes decide, plan changes, store activation, and mock connect without deadlocks", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const storeId = "audit-deadlock-store";
    const failures: string[] = [];
    try {
      for (let round = 0; round < 8; round += 1) {
        const results = await Promise.all([
          stressCall(async () =>
            app.request(`/recommendations/${created.id}/decide`, {
              method: "POST",
              headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
              body: JSON.stringify({ action: round % 2 === 0 ? "deny" : "snooze" }),
            }),
          ),
          stressCall(async () =>
            app.request(`/recommendations/${created.id}/decide`, {
              method: "POST",
              headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
              body: JSON.stringify({ action: "snooze" }),
            }),
          ),
          stressCall(() => setClientPlan(clientId, "paid")),
          stressCall(() => setClientPlan(clientId, "scholarship")),
          stressCall(() => activateStore(clientId, storeId)),
          stressCall(() => deactivateStore(clientId, storeId)),
          stressCall(async () =>
            app.request("/oauth/mock/connect", {
              method: "POST",
              headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
              body: JSON.stringify({ clientId, platform: "google" }),
            }),
          ),
        ]);
        for (const result of results) {
          if (result) failures.push(result);
        }
      }
      expect(failures.filter((failure) => /deadlock|40P01/i.test(failure))).toEqual([]);
      expect(failures.filter((failure) => /HTTP 5\d\d/.test(failure))).toEqual([]);
      expect(failures).toEqual([]);
    } finally {
      await setClientPlan(clientId, "paid").catch(() => undefined);
      await deactivateStore(clientId, storeId).catch(() => undefined);
      await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    }
  }, 60_000);

  it("rolls back the recommendation change when the audit insert fails", async () => {
    const created = await insertJobRecommendation(draftFor({ workspaceId, clientId, adAccountId: accountId }), {
      source: "native:paid-media",
      module: "paid-media",
    });
    const pool = getPool();
    await pool.query(`
      CREATE OR REPLACE FUNCTION os.reject_client_audit_insert_probe()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit insert probe' USING ERRCODE = '55000';
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER client_audit_log_insert_probe
      BEFORE INSERT ON os.client_audit_log
      FOR EACH ROW
      EXECUTE FUNCTION os.reject_client_audit_insert_probe()
    `);
    try {
      await expect(
        decideRecommendation({
          recommendationId: created.id,
          userId: ownerId,
          action: "deny",
        }),
      ).rejects.toThrow(/audit insert probe|client_audit_log/);
      const rec = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, created.id) });
      expect(rec?.status).toBe("proposed");
      expect(readApproval(rec?.approvalJson).status).toBe("PENDING_APPROVAL");
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS client_audit_log_insert_probe ON os.client_audit_log`);
      await pool.query(`DROP FUNCTION IF EXISTS os.reject_client_audit_insert_probe()`);
    }
  });
});

async function stressCall(run: () => Promise<unknown>): Promise<string | null> {
  try {
    const value = await run();
    if (value instanceof Response && value.status >= 500) {
      const text = await value.text();
      return `HTTP ${value.status} ${text}`;
    }
    return null;
  } catch (error) {
    if (error instanceof EntitlementError) return null;
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current; depth += 1) {
      if (current instanceof Error) {
        parts.push(current.message);
        current = current.cause;
      } else {
        parts.push(String(current));
        break;
      }
    }
    return parts.join(" ");
  }
}

async function authorizationCount(recommendationId: string) {
  const rows = await getDb()
    .select({ id: authorizations.id })
    .from(authorizations)
    .where(eq(authorizations.recommendationId, recommendationId));
  return rows.length;
}

async function outsiderTokenFor() {
  const email = "lifecycle-hidden-audit@example.com";
  const password = "other-workspace-only";
  const passwordHash = await hash(password, 10);
  const db = getDb();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  const outsider =
    existing ??
    (await db.insert(users).values({ email, name: "Lifecycle Hidden", passwordHash }).returning())[0];
  if (existing) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, outsider.id));
  }
  const workspace =
    (await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Lifecycle Hidden Workspace") })) ??
    (await db.insert(workspaces).values({ name: "Lifecycle Hidden Workspace" }).returning())[0];
  await db
    .insert(memberships)
    .values({ userId: outsider.id, workspaceId: workspace.id, role: "owner" })
    .onConflictDoNothing();
  return (await login(email, password)).token;
}

async function expectTruncateRefused(sql: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await expect(client.query(sql)).rejects.toThrow(/append-only/);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

async function expectTruncateRefusedAsGrantee() {
  const pool = getPool();
  await pool.query(`
    DO $$ BEGIN
      CREATE ROLE audit_truncate_probe NOINHERIT;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
  await pool.query(`GRANT USAGE ON SCHEMA os TO audit_truncate_probe`);
  await pool.query(`GRANT ALL ON os.client_audit_log TO audit_truncate_probe`);
  await pool.query(`GRANT audit_truncate_probe TO CURRENT_USER`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE audit_truncate_probe");
    await expect(client.query("TRUNCATE os.client_audit_log")).rejects.toThrow(/append-only/);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
