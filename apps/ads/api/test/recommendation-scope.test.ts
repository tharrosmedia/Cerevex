import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { NotAdAccountScopedError } from "@tharros/ads-shared/apply-gate";
import { parseRecommendationDraft } from "@tharros/ads-shared/audit-schemas";
import { createApplyJobForAuthorization, listRecommendations, listRecommendationsForClients } from "@tharros/ads-shared/audit";
import { runApplyJob } from "@tharros/ads-shared/apply";
import { insertJobRecommendation } from "@tharros/ads-shared/rec-lifecycle";
import { insertScopedRecommendation, ScopedRecommendationError } from "@tharros/ads-shared/scoped-recommendations";
import {
  applyJobs,
  authorizations,
  clientAuditLog,
  clients,
  locations,
  recommendations,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

describe("store and client recommendation scope", () => {
  let ownerToken = "";
  let readonlyToken = "";
  let workspaceId = "";
  let ownerId = "";
  let gotId = "";
  let kcId = "";
  let accountId = "";
  const createdIds: string[] = [];
  const locationIds: string[] = [];

  beforeAll(async () => {
    await ensureScopedUser();
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    readonlyToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;
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
    const clientRows = await db.select().from(clients).where(eq(clients.workspaceId, workspace.id));
    gotId = clientRows.find((row) => row.name === "Got Ductless")?.id ?? "";
    kcId = clientRows.find((row) => row.name === "KC Prestige")?.id ?? "";
    expect(gotId).toBeTruthy();
    expect(kcId).toBeTruthy();
    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId: gotId, platform: "meta" }),
    });
    expect(connect.status).toBe(200);
    accountId = String(((await json(connect)).adAccount as { id: string }).id);
  });

  afterAll(async () => {
    const db = getDb();
    if (createdIds.length > 0) {
      await db.delete(recommendations).where(inArray(recommendations.id, createdIds));
    }
    if (locationIds.length > 0) {
      await db.delete(locations).where(inArray(locations.id, locationIds));
    }
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    expect(workspace?.applyKillSwitch).toBe(true);
    await closeDb();
  });

  async function jobCount(clientId: string) {
    const rows = await getDb().select({ id: applyJobs.id }).from(applyJobs).where(eq(applyJobs.clientId, clientId));
    return rows.length;
  }

  function adsDraft(title: string) {
    return parseRecommendationDraft({
      workspaceId,
      clientId: gotId,
      adAccountId: accountId,
      type: "pause_waste",
      title,
      rationale: "Existing ads path. Kill switch still blocks apply.",
      estimatedImpactUsd: null,
      risk: "low",
      confidence: null,
      evidenceJson: { auditRunId: randomUUID(), ruleId: "scope_test", writes: false },
      proposedMutationsJson: [],
      status: "proposed",
      schemaVersion: "1",
    });
  }

  function scopedInput(
    scope: "store" | "client",
    extra: { clientId?: string; workspaceId?: string; storeId?: string | null; type?: string; title?: string } = {},
  ) {
    return {
      workspaceId: extra.workspaceId ?? workspaceId,
      clientId: extra.clientId ?? gotId,
      scope,
      storeId: extra.storeId,
      type: extra.type ?? (scope === "store" ? "seo_audit" : "account_review"),
      title: extra.title ?? `${scope} recommendation`,
      rationale: "A recommendation that does not change an ad account.",
      source: "test:scope",
    };
  }

  it("inserts store and client recommendations and refuses a mismatched tenant", async () => {
    const freeStore = `brain-store-${randomUUID()}`;
    const storeRec = await insertScopedRecommendation(scopedInput("store", { storeId: freeStore, title: "SEO audit" }));
    createdIds.push(storeRec.id);
    expect(storeRec.scope).toBe("store");
    expect(storeRec.storeId).toBe(freeStore);
    expect(storeRec.adAccountId).toBeNull();
    expect(storeRec.status).toBe("proposed");
    expect(storeRec.approvalJson).toMatchObject({ status: "PENDING_APPROVAL" });

    const clientRec = await insertScopedRecommendation(
      scopedInput("client", { title: "Account review", storeId: null }),
    );
    createdIds.push(clientRec.id);
    expect(clientRec.scope).toBe("client");
    expect(clientRec.storeId).toBeNull();
    expect(clientRec.adAccountId).toBeNull();

    const before = createdIds.length;
    await expect(insertScopedRecommendation(scopedInput("store", { storeId: "   " }))).rejects.toMatchObject({
      reason: "store_required",
    });
    await expect(insertScopedRecommendation(scopedInput("client", { storeId: freeStore }))).rejects.toMatchObject({
      reason: "store_not_allowed",
    });
    await expect(
      insertScopedRecommendation(scopedInput("client", { workspaceId: randomUUID(), title: "wrong workspace" })),
    ).rejects.toBeInstanceOf(ScopedRecommendationError);
    await expect(
      insertScopedRecommendation(scopedInput("store", { clientId: kcId, workspaceId: randomUUID(), storeId: freeStore })),
    ).rejects.toMatchObject({ reason: "client_not_found" });
    await expect(
      insertScopedRecommendation({ ...scopedInput("client"), type: "  ", title: "blank" }),
    ).rejects.toThrow(/required/);

    const taken = `taken-${randomUUID()}`;
    const [location] = await getDb()
      .insert(locations)
      .values({ workspaceId, clientId: kcId, storeId: taken, status: "active" })
      .returning();
    locationIds.push(location.id);
    await expect(insertScopedRecommendation(scopedInput("store", { storeId: taken }))).rejects.toMatchObject({
      reason: "store_client_mismatch",
    });
    expect(createdIds).toHaveLength(before);
  });

  it("lists mixed scopes for the client and hides them from another client and workspace", async () => {
    const marker = randomUUID();
    const storeRec = await insertScopedRecommendation(
      scopedInput("store", { storeId: `list-${marker}`, title: `store ${marker}`, type: "seo_audit" }),
    );
    const clientRec = await insertScopedRecommendation(
      scopedInput("client", { title: `client ${marker}`, type: "account_review" }),
    );
    const ads = await insertJobRecommendation(adsDraft(`ads ${marker}`), { source: "native:audit" });
    createdIds.push(storeRec.id, clientRec.id, ads.id);

    const listed = await listRecommendations(gotId, workspaceId);
    const mine = listed.filter((row) => [storeRec.id, clientRec.id, ads.id].includes(row.id));
    expect(mine.map((row) => row.scope).sort()).toEqual(["ad_account", "client", "store"]);
    expect(mine.find((row) => row.id === ads.id)).toMatchObject({
      scope: "ad_account",
      adAccountId: accountId,
      storeId: null,
    });
    expect(await listRecommendations(gotId, randomUUID())).toEqual([]);
    expect(await listRecommendationsForClients([gotId], 100, [randomUUID()])).toEqual([]);

    const ownerList = await app.request(`/clients/${gotId}/recommendations`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerList.status).toBe(200);
    const ownerRows = (await json(ownerList)).recommendations as { id: string; scope: string }[];
    expect(ownerRows.filter((row) => row.id === storeRec.id || row.id === clientRec.id || row.id === ads.id).map((row) => row.scope).sort()).toEqual([
      "ad_account",
      "client",
      "store",
    ]);

    const kcList = await app.request(`/clients/${kcId}/recommendations`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const kcRows = (await json(kcList)).recommendations as { id: string }[];
    expect(kcRows.some((row) => row.id === storeRec.id || row.id === clientRec.id)).toBe(false);

    const hidden = await app.request(`/clients/${kcId}/recommendations`, {
      headers: { authorization: `Bearer ${readonlyToken}` },
    });
    expect(hidden.status).toBe(404);
    const hiddenQuery = await app.request(`/recommendations?clientId=${kcId}`, {
      headers: { authorization: `Bearer ${readonlyToken}` },
    });
    expect(hiddenQuery.status).toBe(404);
    const readonlyList = await app.request("/recommendations", {
      headers: { authorization: `Bearer ${readonlyToken}` },
    });
    const readonlyRows = (await json(readonlyList)).recommendations as { id: string; clientId: string }[];
    expect(readonlyRows.every((row) => row.clientId === gotId)).toBe(true);
    expect(readonlyRows.some((row) => row.id === storeRec.id)).toBe(true);

    const [otherWs] = await getDb().insert(workspaces).values({ name: `scope-iso-${marker}` }).returning();
    const [otherClient] = await getDb()
      .insert(clients)
      .values({ workspaceId: otherWs.id, name: `iso-${marker}` })
      .returning();
    const foreign = await insertScopedRecommendation(
      scopedInput("client", {
        workspaceId: otherWs.id,
        clientId: otherClient.id,
        title: `foreign ${marker}`,
      }),
    );
    createdIds.push(foreign.id);
    expect(await listRecommendations(otherClient.id, workspaceId)).toEqual([]);
    const leaked = await app.request(`/recommendations/${foreign.id}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(leaked.status).toBe(404);
    const cockpit = await app.request("/recommendations", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const cockpitRows = (await json(cockpit)).recommendations as { id: string }[];
    expect(cockpitRows.some((row) => row.id === foreign.id)).toBe(false);
  });

  it("approves store and client recommendations as decisions and refuses ads apply", async () => {
    const storeRec = await insertScopedRecommendation(
      scopedInput("store", { storeId: `apply-${randomUUID()}`, title: "Apply store" }),
    );
    const clientRec = await insertScopedRecommendation(scopedInput("client", { title: "Apply client" }));
    const denyRec = await insertScopedRecommendation(scopedInput("client", { title: "Deny client" }));
    createdIds.push(storeRec.id, clientRec.id, denyRec.id);

    const before = await jobCount(gotId);
    const approved = await app.request(`/recommendations/${storeRec.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approved.status).toBe(200);
    const approvedBody = await json(approved);
    expect(approvedBody.reason).toBe("not_ad_account_scoped");
    expect(approvedBody.applyJob).toBeNull();
    expect(approvedBody.writes).toBe(false);
    expect(approvedBody.applied).toBe(false);
    expect((approvedBody.recommendation as { status: string }).status).toBe("authorized");
    expect((approvedBody.authorization as { scope: { kind: string; writes: boolean } }).scope).toMatchObject({
      kind: "os.decision-only",
      writes: false,
    });
    expect(await jobCount(gotId)).toBe(before);

    const clientApproved = await app.request(`/recommendations/${clientRec.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(clientApproved.status).toBe(200);
    expect((await json(clientApproved)).reason).toBe("not_ad_account_scoped");
    expect(await jobCount(gotId)).toBe(before);

    const denied = await app.request(`/recommendations/${denyRec.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny" }),
    });
    expect(denied.status).toBe(200);
    const deniedBody = await json(denied);
    expect(deniedBody.writes).toBe(false);
    expect((deniedBody.recommendation as { status: string }).status).toBe("denied");
    expect(await jobCount(gotId)).toBe(before);

    const apply = await app.request(`/recommendations/${storeRec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(apply.status).toBe(409);
    const applyBody = await json(apply);
    expect(applyBody.reason).toBe("not_ad_account_scoped");
    expect(applyBody.applyJob).toBeNull();
    expect(applyBody.writes).toBe(false);
    expect(await jobCount(gotId)).toBe(before);

    await expect(
      createApplyJobForAuthorization({
        workspaceId,
        clientId: gotId,
        authorizationId: (approvedBody.authorization as { id: string }).id,
        recommendationId: storeRec.id,
        proposedMutations: [],
      }),
    ).rejects.toBeInstanceOf(NotAdAccountScopedError);
    expect(await jobCount(gotId)).toBe(before);

    const ads = await insertJobRecommendation(adsDraft("Still an ads rec"), { source: "native:audit" });
    createdIds.push(ads.id);
    const blocked = await app.request(`/recommendations/${ads.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(blocked.status).toBe(409);
    expect(String((await json(blocked)).error)).toMatch(/paused/i);
    const still = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, ads.id) });
    expect(still?.status).toBe("proposed");
    expect(still?.scope).toBe("ad_account");
    expect(await jobCount(gotId)).toBe(before);

    const authorizationId = (approvedBody.authorization as { id: string }).id;
    const [queued] = await getDb()
      .insert(applyJobs)
      .values({
        workspaceId,
        clientId: gotId,
        authorizationId,
        idempotencyKey: `scope-test-${storeRec.id}`,
        status: "queued",
        requestJson: { recommendationId: storeRec.id, proposedMutations: [] },
      })
      .returning();
    expect(await jobCount(gotId)).toBe(before + 1);
    const ran = await runApplyJob(queued.id);
    expect(ran.writes).toBe(false);
    expect(ran.blocked).toBe("not_ad_account_scoped");
    expect(ran.applyJob.status).toBe("failed");
    expect(ran.applyJob.error).toBe("not_ad_account_scoped");
    const stored = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, queued.id) });
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toBe("not_ad_account_scoped");
    expect(stored?.responseJson).toMatchObject({ writes: false });
    expect(await jobCount(gotId)).toBe(before + 1);
    const stillAuthorized = await getDb().query.recommendations.findFirst({
      where: eq(recommendations.id, storeRec.id),
    });
    expect(stillAuthorized?.status).toBe("authorized");
    expect(await getDb().select({ id: authorizations.id }).from(authorizations).where(eq(authorizations.id, authorizationId))).toHaveLength(1);
    expect(ownerId).toBeTruthy();
  });

  it("writes store-scoped decision rows on the recommendation store, not the client site", async () => {
    const primary = "cq-primary-site";
    const storeId = "cq-second-location";
    const db = getDb();
    const before = await db.query.clients.findFirst({ where: eq(clients.id, gotId) });
    await db.update(clients).set({ siteId: primary }).where(eq(clients.id, gotId));
    try {
      const approvedRec = await insertScopedRecommendation(
        scopedInput("store", { storeId, title: "Second location approve" }),
      );
      const deniedRec = await insertScopedRecommendation(
        scopedInput("store", { storeId, title: "Second location deny" }),
      );
      createdIds.push(approvedRec.id, deniedRec.id);

      const refused = await app.request(`/recommendations/${approvedRec.id}/apply`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(refused.status).toBe(409);

      const approved = await app.request(`/recommendations/${approvedRec.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(approved.status).toBe(200);
      const authorizationId = String(((await json(approved)).authorization as { id: string }).id);
      const [queued] = await db
        .insert(applyJobs)
        .values({
          workspaceId,
          clientId: gotId,
          authorizationId,
          idempotencyKey: `scope-store-${approvedRec.id}`,
          status: "queued",
          requestJson: { recommendationId: approvedRec.id, proposedMutations: [] },
        })
        .returning();
      const ran = await runApplyJob(queued.id);
      expect(ran.blocked).toBe("not_ad_account_scoped");

      const denied = await app.request(`/recommendations/${deniedRec.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "deny" }),
      });
      expect(denied.status).toBe(200);

      const rows = await db
        .select({ action: clientAuditLog.action, storeId: clientAuditLog.storeId, entityId: clientAuditLog.entityId })
        .from(clientAuditLog)
        .where(inArray(clientAuditLog.entityId, [approvedRec.id, deniedRec.id]));
      for (const action of ["approved", "rejected", "approve_refused", "apply_blocked"] as const) {
        const matches = rows.filter((row) => row.action === action);
        expect(matches.length).toBeGreaterThan(0);
        expect(matches.every((row) => row.storeId === storeId)).toBe(true);
        expect(matches.some((row) => row.storeId === primary)).toBe(false);
      }
    } finally {
      await db.update(clients).set({ siteId: before?.siteId ?? null }).where(eq(clients.id, gotId));
    }
  });

  for (const clientSite of ["cq-primary-site", null] as const) {
    describe(`store rec audit rows when the client site_id is ${clientSite ?? "NULL"}`, () => {
      const storeId = "cq-second-location";
      let previousSite: string | null = null;

      beforeAll(async () => {
        const db = getDb();
        const before = await db.query.clients.findFirst({ where: eq(clients.id, gotId) });
        previousSite = before?.siteId ?? null;
        await db.update(clients).set({ siteId: clientSite }).where(eq(clients.id, gotId));
      });

      afterAll(async () => {
        await getDb().update(clients).set({ siteId: previousSite }).where(eq(clients.id, gotId));
      });

      async function storeRec(title: string) {
        const rec = await insertScopedRecommendation(scopedInput("store", { storeId, title: `${title} (${clientSite ?? "null"})` }));
        createdIds.push(rec.id);
        return rec;
      }

      function post(path: string, body: unknown) {
        return app.request(path, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      async function approve(recId: string) {
        const res = await post(`/recommendations/${recId}/decide`, { action: "approve" });
        expect(res.status).toBe(200);
        return String(((await json(res)).authorization as { id: string }).id);
      }

      async function expectRecStore(recId: string, action: string, count?: number) {
        const rows = await getDb()
          .select({ storeId: clientAuditLog.storeId })
          .from(clientAuditLog)
          .where(and(eq(clientAuditLog.entityId, recId), eq(clientAuditLog.action, action)));
        if (count === undefined) expect(rows.length, action).toBeGreaterThan(0);
        else expect(rows.length, action).toBe(count);
        expect(rows.map((row) => row.storeId), action).toEqual(rows.map(() => storeId));
      }

      it("rec_created", async () => {
        const rec = await storeRec("Created");
        await expectRecStore(rec.id, "rec_created", 1);
      });

      it("approve (decide)", async () => {
        const rec = await storeRec("Approve");
        await approve(rec.id);
        await expectRecStore(rec.id, "approved", 1);
      });

      it("deny (decide)", async () => {
        const rec = await storeRec("Deny");
        expect((await post(`/recommendations/${rec.id}/decide`, { action: "deny" })).status).toBe(200);
        await expectRecStore(rec.id, "rejected", 1);
      });

      it("approve refusal", async () => {
        const applyRefused = await storeRec("Apply refused");
        expect((await post(`/recommendations/${applyRefused.id}/apply`, {})).status).toBe(409);
        await expectRecStore(applyRefused.id, "approve_refused", 1);

        const markDoneEarly = await storeRec("Mark done before approve");
        expect((await post(`/recommendations/${markDoneEarly.id}/decide`, { action: "mark_done" })).status).toBe(409);
        await expectRecStore(markDoneEarly.id, "approve_refused", 1);
      });

      it("apply client audit", async () => {
        const rec = await storeRec("Worker apply");
        const authorizationId = await approve(rec.id);
        const [queued] = await getDb()
          .insert(applyJobs)
          .values({
            workspaceId,
            clientId: gotId,
            authorizationId,
            idempotencyKey: `scope-store-site-${rec.id}`,
            status: "queued",
            requestJson: { recommendationId: rec.id, proposedMutations: [] },
          })
          .returning();
        const ran = await runApplyJob(queued.id);
        expect(ran.blocked).toBe("not_ad_account_scoped");
        await expectRecStore(rec.id, "apply_blocked");
      });

      it("mark_done (decide)", async () => {
        const rec = await storeRec("Mark done");
        await approve(rec.id);
        expect((await post(`/recommendations/${rec.id}/decide`, { action: "mark_done" })).status).toBe(200);
        await expectRecStore(rec.id, "mark_done", 1);
      });

      it("rolled_back (decide)", async () => {
        const rec = await storeRec("Roll back");
        await approve(rec.id);
        expect((await post(`/recommendations/${rec.id}/decide`, { action: "mark_done" })).status).toBe(200);
        expect((await post(`/recommendations/${rec.id}/decide`, { action: "rollback" })).status).toBe(200);
        await expectRecStore(rec.id, "rolled_back", 1);
      });

      it("lifecycle route, with and without a caller storeId", async () => {
        const rec = await storeRec("Lifecycle");
        await approve(rec.id);
        const done = await post("/recommendations/lifecycle", { kind: "mark_done", recommendationId: rec.id, clientId: gotId });
        expect(done.status).toBe(200);
        await expectRecStore(rec.id, "mark_done", 1);
        const rolledBack = await post("/recommendations/lifecycle", {
          kind: "rolled_back",
          recommendationId: rec.id,
          clientId: gotId,
          storeId: "caller-supplied-store",
        });
        expect(rolledBack.status).toBe(200);
        await expectRecStore(rec.id, "rolled_back", 1);
      });
    });
  }

  it("keeps the kill switch on", async () => {
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    expect(workspace?.applyKillSwitch).toBe(true);
    const flag = await getDb().execute(sql`select apply_kill_switch from os.workspaces where id = ${workspaceId}`);
    expect(Boolean((flag.rows[0] as { apply_kill_switch: boolean }).apply_kill_switch)).toBe(true);
  });
});
