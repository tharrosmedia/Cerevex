import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { loadEnv } from "@tharros/ads-shared/env";
import { ADS_POOL_MAX, closeDb, getDb } from "@tharros/ads-shared/db";
import { runApplyJob } from "@tharros/ads-shared/apply";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import {
  adAccounts,
  adEntities,
  applyJobs,
  auditLog,
  authorizations,
  clients,
  decisions,
  memberships,
  oauthPendingConnections,
  recommendations,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { hash } from "bcryptjs";
import { getAdPlatformConnector } from "@tharros/ads-shared/connectors";
import { assertServiceWorkspaceConfigured } from "../src/auth";
import { signOAuthState } from "../src/oauth-state";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const INTERNAL_KEY = "test-internal-service-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;
const ORIGINAL_WORKSPACE = process.env.ADS_INTERNAL_WORKSPACE_ID;
const OTHER_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000aa";

describe("service actor, authorization revoke, and decide/apply oracle", () => {
  let ownerToken = "";
  let scopedToken = "";
  let ownerId = "";
  let clientId = "";
  let otherClientId = "";
  let accountId = "";
  let entityId = "";
  let entityExternalId = "";
  let entityType = "";
  let workspaceId = "";

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    await ensureScopedUser();
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    ownerToken = owner.token;
    scopedToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;

    const me = await json(
      await app.request("/auth/me", { headers: { authorization: `Bearer ${ownerToken}` } }),
    );
    ownerId = String((me.user as { id: string }).id);

    const clientsRes = await app.request("/clients", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const clients = (await json(clientsRes)).clients as { id: string; name: string; workspaceId: string }[];
    const got = clients.find((row) => row.name === "Got Ductless");
    const other = clients.find((row) => row.name === "KC Prestige");
    if (!got || !other) throw new Error("Seed clients missing");
    clientId = got.id;
    otherClientId = other.id;
    workspaceId = got.workspaceId;

    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "meta" }),
    });
    accountId = String(((await json(connect)).adAccount as { id: string }).id);
    await runAdAccountSync(accountId);
    const entity = await getDb().query.adEntities.findFirst({
      where: eq(adEntities.adAccountId, accountId),
    });
    if (!entity) throw new Error("Mock sync produced no entity");
    entityId = entity.id;
    entityExternalId = entity.externalId;
    entityType = entity.entityType;

    const flip = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(flip.status).toBe(200);
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
  });

  afterAll(async () => {
    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
    if (ORIGINAL_WORKSPACE === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = ORIGINAL_WORKSPACE;
    await closeDb();
  });

  function internalHeaders(jsonBody = false): Record<string, string> {
    return {
      "x-cerevex-internal-key": INTERNAL_KEY,
      ...(jsonBody ? { "content-type": "application/json" } : {}),
    };
  }

  async function resetEntity() {
    await getDb().update(adEntities).set({ status: "active" }).where(eq(adEntities.id, entityId));
  }

  async function insertRec(targetClientId = clientId) {
    await resetEntity();
    const [row] = await getDb()
      .insert(recommendations)
      .values({
        workspaceId,
        clientId: targetClientId,
        adAccountId: accountId,
        type: "pause_waste",
        title: "Pause a test entity",
        rationale: "Service-actor revoke test. No live platform.",
        risk: "low",
        evidenceJson: { writes: false },
        proposedMutationsJson: [
          {
            platform: "meta",
            action: "pause",
            target: { entityType, externalId: entityExternalId, name: "test" },
            payload: {},
            execute: false,
          },
        ],
        status: "proposed",
        schemaVersion: "1",
      })
      .returning();
    return row;
  }

  async function counts() {
    const db = getDb();
    const [decisionRows, authorizationRows, jobRows, auditRows] = await Promise.all([
      db.select({ id: decisions.id }).from(decisions),
      db.select({ id: authorizations.id }).from(authorizations),
      db.select({ id: applyJobs.id }).from(applyJobs),
      db.select({ id: auditLog.id, actorId: auditLog.actorId, actorType: auditLog.actorType }).from(auditLog),
    ]);
    return {
      decisions: decisionRows.length,
      authorizations: authorizationRows.length,
      jobs: jobRows.length,
      audits: auditRows.length,
      ownerAudits: auditRows.filter((row) => row.actorId === ownerId).length,
      userAudits: auditRows.filter((row) => row.actorType === "user" && row.actorId === ownerId).length,
    };
  }

  async function approveQueued(recId: string) {
    const res = await app.request(`/recommendations/${recId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", note: "queue only" }),
    });
    const body = await json(res);
    expect(res.status).toBe(200);
    const job = body.applyJob as { id: string; status: string };
    expect(job.status).toBe("queued");
    return job.id;
  }

  it("refuses an internal-key approve or apply with no write and no human attribution", async () => {
    const rec = await insertRec();
    const before = await counts();

    const approve = await app.request(`/recommendations/${rec.id}/decide`, {
      method: "POST",
      headers: internalHeaders(true),
      body: JSON.stringify({ action: "approve" }),
    });
    const apply = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: internalHeaders(true),
      body: JSON.stringify({}),
    });
    const authorize = await app.request(`/recommendations/${rec.id}/decide`, {
      method: "POST",
      headers: internalHeaders(true),
      body: JSON.stringify({ action: "authorize" }),
    });

    expect(approve.status).toBe(403);
    expect(apply.status).toBe(403);
    expect(authorize.status).toBe(403);
    for (const res of [approve, apply, authorize]) {
      expect(String((await json(res)).error)).toMatch(/cannot approve or apply/i);
    }

    const stored = await getDb().query.recommendations.findFirst({
      where: eq(recommendations.id, rec.id),
    });
    expect(stored?.status).toBe("proposed");
    const after = await counts();
    expect(after.decisions).toBe(before.decisions);
    expect(after.authorizations).toBe(before.authorizations);
    expect(after.jobs).toBe(before.jobs);
    expect(after.audits).toBe(before.audits);
    expect(after.ownerAudits).toBe(before.ownerAudits);

    const me = await json(await app.request("/auth/me", { headers: internalHeaders() }));
    expect(me.principal).toBe("service");
    expect(me.user).toBeNull();
    expect(me.canApprove).toBe(false);
    expect(JSON.stringify(me)).not.toContain(ownerId);
    expect(JSON.stringify(me)).not.toContain("adam@tharrosmedia.com");
  });

  it("records internal-key audit rows as the service actor", async () => {
    const beforeIds = new Set(
      (await getDb().select({ id: auditLog.id }).from(auditLog)).map((row) => row.id),
    );
    const res = await app.request(`/clients/${clientId}/audits`, {
      method: "POST",
      headers: internalHeaders(true),
      body: JSON.stringify({ inline: true, adAccountId: accountId }),
    });
    expect(res.status).toBe(200);
    const rows = (await getDb().select().from(auditLog)).filter((row) => !beforeIds.has(row.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.actorType === "service" && row.actorId === null)).toBe(true);
    expect(rows.every((row) => row.actorId === null)).toBe(true);
    expect(rows.every((row) => row.actorType !== "user")).toBe(true);
    expect(rows.some((row) => row.actorId === ownerId)).toBe(false);
  });

  it("revokes the authorization when deny or snooze follows approve", async () => {
    for (const action of ["deny", "snooze"] as const) {
      const rec = await insertRec();
      await approveQueued(rec.id);
      const res = await app.request(`/recommendations/${rec.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      expect(res.status).toBe(200);
      const stored = await getDb().query.recommendations.findFirst({
        where: eq(recommendations.id, rec.id),
      });
      expect(stored?.status).toBe(action === "deny" ? "denied" : "snoozed");
      const [authz] = await getDb()
        .select()
        .from(authorizations)
        .where(eq(authorizations.recommendationId, rec.id));
      expect(authz?.revokedAt).toBeTruthy();
    }
  });

  it("does not call the platform when a queued apply is denied before the worker runs", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    const deny = await app.request(`/recommendations/${rec.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny" }),
    });
    expect(deny.status).toBe(200);

    const ran = await runApplyJob(jobId);
    expect(ran.writes).toBe(false);
    expect(ran.blocked).toBe("authorization_revoked");
    expect(ran.outcomes).toEqual([]);
    const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
    expect(entity?.status).toBe("active");
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    expect(audits.some((row) => row.action === "revoked" && row.actorId === null)).toBe(true);
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("authorization_revoked");
  });

  it("never applies after a parallel deny commits", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let running: ReturnType<typeof runApplyJob> | null = null;
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT id FROM os.recommendations WHERE id = $1::uuid FOR UPDATE`,
        [rec.id],
      );
      expect(locked.rowCount).toBe(1);
      running = runApplyJob(jobId);
      const sawWait = await waitForApplyLock(client, 4000);
      expect(sawWait).toBe(true);
      const during = await client.query(`SELECT status FROM os.ad_entities WHERE id = $1`, [entityId]);
      expect(during.rows[0]?.status).toBe("active");
      await client.query(
        `UPDATE os.authorizations SET revoked_at = now() WHERE recommendation_id = $1 AND revoked_at IS NULL`,
        [rec.id],
      );
      await client.query(`UPDATE os.recommendations SET status = 'denied' WHERE id = $1`, [rec.id]);
      await client.query("COMMIT");
      const ran = await running;
      expect(ran.writes).toBe(false);
      expect(ran.blocked).toBe("authorization_revoked");
      expect(ran.outcomes).toEqual([]);
      const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
      expect(entity?.status).toBe("active");
      const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
      expect(audits.some((row) => row.action === "revoked")).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
      await running?.catch(() => undefined);
    }
  });

  it("returns the same 404 for a missing recommendation and one the caller cannot access", async () => {
    const hidden = await insertRec(otherClientId);
    const missingId = "00000000-0000-4000-8000-000000000000";
    const beforeAudits = (await getDb().select({ id: auditLog.id }).from(auditLog)).length;
    const beforeStatus = (
      await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, hidden.id) })
    )?.status;

    const cases = [
      { path: `/recommendations/${missingId}/decide`, body: { action: "deny" } },
      { path: `/recommendations/${hidden.id}/decide`, body: { action: "deny" } },
      { path: `/recommendations/${missingId}/apply`, body: {} },
      { path: `/recommendations/${hidden.id}/apply`, body: {} },
    ];
    const results = [];
    for (const item of cases) {
      const res = await app.request(item.path, {
        method: "POST",
        headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
        body: JSON.stringify(item.body),
      });
      const body = await json(res);
      results.push({ status: res.status, error: body.error });
    }

    expect(results[0]).toEqual(results[1]);
    expect(results[2]).toEqual(results[3]);
    expect(results[0]).toEqual({ status: 404, error: "Recommendation not found" });
    expect(results[2]).toEqual({ status: 404, error: "Recommendation not found" });

    const afterStatus = (
      await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, hidden.id) })
    )?.status;
    expect(afterStatus).toBe(beforeStatus);
    const afterAudits = (await getDb().select({ id: auditLog.id }).from(auditLog)).length;
    expect(afterAudits).toBe(beforeAudits);
  });

  it("returns 409 when approve loses the race to deny, and one job for parallel approves", async () => {
    for (let trial = 0; trial < 8; trial += 1) {
      const rec = await insertRec();
      const [approve, deny] = await Promise.all([
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        }),
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "deny" }),
        }),
      ]);
      expect(approve.status).not.toBe(500);
      expect(deny.status).not.toBe(500);
      expect([200, 409]).toContain(approve.status);
      expect([200, 409]).toContain(deny.status);
      const stored = await getDb().query.recommendations.findFirst({
        where: eq(recommendations.id, rec.id),
      });
      const auths = await getDb()
        .select()
        .from(authorizations)
        .where(eq(authorizations.recommendationId, rec.id));
      const live = auths.filter((row) => row.revokedAt == null);
      if (deny.status === 200) {
        expect(stored?.status).toBe("denied");
        expect(live).toHaveLength(0);
      }
      if (approve.status === 409) {
        expect(stored?.status).toBe("denied");
      }
    }

    const rec = await insertRec();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        }),
      ),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
    const auths = await getDb()
      .select()
      .from(authorizations)
      .where(eq(authorizations.recommendationId, rec.id));
    expect(auths).toHaveLength(1);
    const jobs = await getDb().select().from(applyJobs).where(eq(applyJobs.authorizationId, auths[0]!.id));
    expect(jobs).toHaveLength(1);
  });

  it("serializes deny and snooze so a deny that returned 200 stays denied", async () => {
    for (let trial = 0; trial < 8; trial += 1) {
      const rec = await insertRec();
      const [deny, snooze] = await Promise.all([
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "deny" }),
        }),
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "snooze" }),
        }),
      ]);
      expect([deny.status, snooze.status].sort()).toEqual([200, 409]);
      const stored = await getDb().query.recommendations.findFirst({
        where: eq(recommendations.id, rec.id),
      });
      if (deny.status === 200) {
        expect(stored?.status).toBe("denied");
      } else {
        expect(stored?.status).toBe("snoozed");
      }
    }

    for (let trial = 0; trial < 4; trial += 1) {
      const rec = await insertRec();
      const [approve, deny, snooze] = await Promise.all([
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        }),
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "deny" }),
        }),
        app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "snooze" }),
        }),
      ]);
      for (const res of [approve, deny, snooze]) expect(res.status).not.toBe(500);
      const stored = await getDb().query.recommendations.findFirst({
        where: eq(recommendations.id, rec.id),
      });
      const live = (
        await getDb().select().from(authorizations).where(eq(authorizations.recommendationId, rec.id))
      ).filter((row) => row.revokedAt == null);
      if (deny.status === 200) {
        expect(stored?.status).toBe("denied");
        expect(live).toHaveLength(0);
      }
    }
  });

  it("finishes more apply jobs than the pool size", async () => {
    const count = ADS_POOL_MAX + 2;
    const jobIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const rec = await insertRec();
      jobIds.push(await approveQueued(rec.id));
    }
    const ran = await Promise.all(jobIds.map((id) => runApplyJob(id)));
    expect(ran).toHaveLength(count);
    expect(ran.every((row) => row.applyJob.status === "succeeded" || row.applyJob.status === "failed")).toBe(true);
    expect(ran.some((row) => row.writes === true)).toBe(true);
    expect(ran.every((row) => row.blocked == null)).toBe(true);
  });

  it("stores a null user id when the service principal starts a multi-account connect", async () => {
    const connector = getAdPlatformConnector("meta");
    const originalExchange = connector.exchangeCode.bind(connector);
    const originalList = connector.listAccessibleAccounts.bind(connector);
    const previousConsole = process.env.CONSOLE_ORIGIN;
    process.env.CONSOLE_ORIGIN = "http://127.0.0.1:43181";
    connector.exchangeCode = async () => ({
      externalId: "act_service_pending",
      tokens: {
        accessToken: "service-oauth-test-token",
        refreshToken: "service-oauth-test-refresh",
        mock: true,
        scopes: [],
      },
    });
    connector.listAccessibleAccounts = async () => [
      { externalId: "act_service_one", name: "Service One" },
      { externalId: "act_service_two", name: "Service Two" },
    ];
    try {
      const state = await signOAuthState({ userId: "service", clientId, platform: "meta" });
      const callback = await app.request(
        `/oauth/meta/callback?code=service-test-code&state=${encodeURIComponent(state)}`,
      );
      expect(callback.status).toBe(302);
      const location = callback.headers.get("location") ?? "";
      expect(location).not.toMatch(/oauth_error=/);
      const pendingId = new URL(location).searchParams.get("pending");
      expect(pendingId).toBeTruthy();
      const row = await getDb().query.oauthPendingConnections.findFirst({
        where: eq(oauthPendingConnections.id, pendingId!),
      });
      expect(row?.userId).toBeNull();
      expect(row?.clientId).toBe(clientId);
    } finally {
      connector.exchangeCode = originalExchange;
      connector.listAccessibleAccounts = originalList;
      if (previousConsole === undefined) delete process.env.CONSOLE_ORIGIN;
      else process.env.CONSOLE_ORIGIN = previousConsole;
    }
  });

  it("cannot read or change another workspace", async () => {
    const db = getDb();
    await db
      .insert(workspaces)
      .values({
        id: OTHER_WORKSPACE_ID,
        name: "Other Tenant",
        applyKillSwitch: true,
        settingsJson: { marker: "other-tenant" },
      })
      .onConflictDoNothing();
    const [otherClient] = await db
      .insert(clients)
      .values({ workspaceId: OTHER_WORKSPACE_ID, name: "Other Tenant Client" })
      .onConflictDoNothing()
      .returning();
    const otherClientRow =
      otherClient ??
      (await db.query.clients.findFirst({
        where: eq(clients.name, "Other Tenant Client"),
      }));
    if (!otherClientRow) throw new Error("other client missing");
    const [otherAccount] = await db
      .insert(adAccounts)
      .values({
        workspaceId: OTHER_WORKSPACE_ID,
        clientId: otherClientRow.id,
        platform: "meta",
        externalId: "act_other_tenant",
        displayName: "Other Tenant Ads",
        connectionStatus: "connected",
        frozen: false,
      })
      .onConflictDoNothing()
      .returning();
    const otherAccountRow =
      otherAccount ??
      (await db.query.adAccounts.findFirst({
        where: eq(adAccounts.externalId, "act_other_tenant"),
      }));
    if (!otherAccountRow) throw new Error("other account missing");
    const [otherRec] = await db
      .insert(recommendations)
      .values({
        workspaceId: OTHER_WORKSPACE_ID,
        clientId: otherClientRow.id,
        adAccountId: otherAccountRow.id,
        type: "pause_waste",
        title: "Other tenant rec",
        rationale: "Must stay proposed.",
        risk: "low",
        evidenceJson: {},
        proposedMutationsJson: [],
        status: "proposed",
        schemaVersion: "1",
      })
      .returning();

    const workspaceView = await json(await app.request("/workspace", { headers: internalHeaders() }));
    expect((workspaceView.workspace as { id: string }).id).toBe(workspaceId);
    expect((workspaceView.workspace as { id: string }).id).not.toBe(OTHER_WORKSPACE_ID);

    const listed = await json(await app.request("/clients", { headers: internalHeaders() }));
    const names = (listed.clients as { name: string; workspaceId: string }[]).map((row) => row.workspaceId);
    expect(names.every((id) => id === workspaceId)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("Other Tenant Client");

    const freeze = await app.request(`/ad-accounts/${otherAccountRow.id}`, {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ frozen: false }),
    });
    expect(freeze.status).toBe(404);
    const frozen = await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, otherAccountRow.id) });
    expect(frozen?.frozen).toBe(false);

    const caps = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ capabilities: { "connect.meta": "hidden" } }),
    });
    expect(caps.status).toBe(200);
    const otherWorkspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, OTHER_WORKSPACE_ID) });
    expect(otherWorkspace?.applyKillSwitch).toBe(true);
    expect(JSON.stringify(otherWorkspace?.settingsJson ?? {})).toBe(JSON.stringify({ marker: "other-tenant" }));
    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.meta": "on" } }),
    });

    const kill = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(kill.status).toBe(200);
    const otherAfterKill = await db.query.workspaces.findFirst({ where: eq(workspaces.id, OTHER_WORKSPACE_ID) });
    expect(otherAfterKill?.applyKillSwitch).toBe(true);
    const own = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    expect(own?.applyKillSwitch).toBe(false);
    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });

    const deny = await app.request(`/recommendations/${otherRec.id}/decide`, {
      method: "POST",
      headers: internalHeaders(true),
      body: JSON.stringify({ action: "deny" }),
    });
    const snooze = await app.request(`/recommendations/${otherRec.id}/decide`, {
      method: "POST",
      headers: internalHeaders(true),
      body: JSON.stringify({ action: "snooze" }),
    });
    expect(deny.status).toBe(404);
    expect(snooze.status).toBe(404);
    expect(String((await json(deny)).error)).toBe("Recommendation not found");
    const still = await db.query.recommendations.findFirst({ where: eq(recommendations.id, otherRec.id) });
    expect(still?.status).toBe("proposed");

    delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    const refused = await app.request("/workspace", { headers: internalHeaders() });
    expect(refused.status).toBe(401);
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    expect(() => assertServiceWorkspaceConfigured()).toThrow(/ADS_INTERNAL_WORKSPACE_ID/);
    process.env.NODE_ENV = previousNodeEnv;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
  });

  it("uses the same 404 for a read-only user and a workspace-only user on a visible recommendation", async () => {
    const rec = await insertRec();
    const email = "workspace.readonly@tharrosmedia.com";
    const passwordHash = await hash("workspace-readonly-local", 10);
    const existing = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    const user =
      existing ??
      (await getDb().insert(users).values({ email, name: "Workspace readonly", passwordHash }).returning())[0];
    if (!user) throw new Error("readonly user missing");
    if (existing) await getDb().update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await getDb()
      .insert(memberships)
      .values({ userId: user.id, workspaceId, role: "client_readonly" })
      .onConflictDoNothing();
    const workspaceOnly = (await login(email, "workspace-readonly-local")).token;

    const cases = [
      { token: scopedToken, path: `/recommendations/${rec.id}/decide`, body: { action: "deny" } },
      { token: scopedToken, path: `/recommendations/${rec.id}/apply`, body: {} },
      { token: workspaceOnly, path: `/recommendations/${rec.id}/decide`, body: { action: "deny" } },
      { token: workspaceOnly, path: `/recommendations/${rec.id}/apply`, body: {} },
    ];
    const results = [];
    for (const item of cases) {
      const res = await app.request(item.path, {
        method: "POST",
        headers: { authorization: `Bearer ${item.token}`, "content-type": "application/json" },
        body: JSON.stringify(item.body),
      });
      results.push({ status: res.status, error: (await json(res)).error });
    }
    expect(results.every((row) => row.status === 404 && row.error === "Recommendation not found")).toBe(true);
    const stored = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, rec.id) });
    expect(stored?.status).toBe("proposed");
  });
});

async function waitForApplyLock(client: pg.Client, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await client.query(
      `SELECT a.pid
       FROM pg_stat_activity a
       WHERE a.pid <> pg_backend_pid()
         AND a.wait_event_type = 'Lock'
       LIMIT 1`,
    );
    if (rows.rowCount) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}
