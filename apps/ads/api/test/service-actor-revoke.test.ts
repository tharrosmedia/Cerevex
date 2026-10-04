import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { applySafetyCapabilityIds, isApplySafetyCapability, resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { loadEnv } from "@tharros/ads-shared/env";
import { ADS_POOL_MAX, closeDb, getDb } from "@tharros/ads-shared/db";
import {
  APPLYING_LEASE_MS,
  APPLY_EXECUTE_DEADLINE_MS,
  PLATFORM_WRITE_TIMEOUT_MS,
  applyOutcomeWrites,
  applyingLeaseRemainingMs,
  closeApplyingJob,
  isAbortedApplyError,
  runApplyJob,
  sanitizeStoredError,
  settledApplyJob,
  shouldRecordApplyAudit,
} from "@tharros/ads-shared/apply";
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

  it("keeps the platform write when deny lands during the call", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    let running: ReturnType<typeof runApplyJob> | null = null;
    try {
      await locker.query("BEGIN");
      await locker.query(`SELECT id FROM os.ad_entities WHERE id = $1 FOR UPDATE`, [entityId]);
      running = runApplyJob(jobId);
      const started = Date.now();
      let writing = false;
      while (Date.now() - started < 4000) {
        const waiting = await locker.query(
          `SELECT a.pid
           FROM pg_stat_activity a
           WHERE a.pid <> pg_backend_pid()
             AND a.wait_event_type = 'Lock'
           LIMIT 1`,
        );
        if (waiting.rowCount) {
          writing = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(writing).toBe(true);
      const deny = await app.request(`/recommendations/${rec.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "deny" }),
      });
      expect(deny.status).toBe(200);
      await locker.query("COMMIT");
      const ran = await running;
      expect(ran.writes).toBe(true);
      expect(ran.outcomes.some((row) => row.writes && row.status === "applied")).toBe(true);
      const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
      expect(entity?.status).toBe("paused");
      const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
      const response = (job?.responseJson ?? {}) as {
        writes?: boolean;
        outcomes?: unknown[];
        revokedDuringApply?: boolean;
        revoked_after_write?: boolean;
      };
      expect(response.writes).toBe(true);
      expect(response.outcomes?.length).toBeGreaterThan(0);
      expect(response.revokedDuringApply).toBe(true);
      expect(response.revoked_after_write).toBe(true);
      const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
      const recorded = audits.filter((row) => row.action === "apply_success");
      expect(recorded).toHaveLength(1);
      const payload = (recorded[0]?.payloadJson ?? {}) as { writes?: boolean; outcomes?: unknown[] };
      expect(payload.writes).toBe(true);
      expect(payload.outcomes?.length).toBeGreaterThan(0);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      await locker.end().catch(() => undefined);
      await running?.catch(() => undefined);
    }
  });

  it("lets only one caller claim a job and hit the platform", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    const ran = await Promise.all([runApplyJob(jobId), runApplyJob(jobId)]);
    expect(ran.filter((row) => row.writes).length).toBeGreaterThan(0);
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(job?.attempts).toBe(1);
    expect(job?.status).toBe("succeeded");
    const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
    expect(entity?.status).toBe("paused");
    const again = await runApplyJob(jobId);
    expect(again.blocked).not.toBe("in_progress");
    const after = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(after?.attempts).toBe(1);

    const second = await insertRec();
    const secondJob = await approveQueued(second.id);
    const [worker, inline] = await Promise.all([
      runApplyJob(secondJob),
      app.request(`/recommendations/${second.id}/apply`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ inline: true }),
      }),
    ]);
    expect([200, 409]).toContain(inline.status);
    if (inline.status === 409) {
      expect((await json(inline)).status).toBe("in_progress");
    }
    expect(worker.applyJob.id).toBe(secondJob);
    const raced = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, secondJob) });
    expect(raced?.attempts).toBe(1);
    expect(raced?.status).toBe("succeeded");
    const paused = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
    expect(paused?.status).toBe("paused");

    await getDb().execute(sql`
      update os.apply_jobs
      set status = 'applying',
          response_json = jsonb_build_object('claimedAt', now())
      where id = ${secondJob}::uuid
    `);
    await resetEntity();
    const crashed = await runApplyJob(secondJob);
    expect(crashed.blocked).toBe("in_progress");
    expect(crashed.writes).toBe(false);
    const still = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
    expect(still?.status).toBe("active");
    const left = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, secondJob) });
    expect(left?.status).toBe("applying");
    expect(left?.attempts).toBe(1);
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

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    const kill = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(kill.status).toBe(403);
    const otherAfterKill = await db.query.workspaces.findFirst({ where: eq(workspaces.id, OTHER_WORKSPACE_ID) });
    expect(otherAfterKill?.applyKillSwitch).toBe(true);
    const own = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    expect(own?.applyKillSwitch).toBe(true);
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
    const previousRailwayName = process.env.RAILWAY_ENVIRONMENT_NAME;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.ADS_INTERNAL_WORKSPACE_ID;
      expect(() => assertServiceWorkspaceConfigured()).toThrow(/ADS_INTERNAL_WORKSPACE_ID/);
      process.env.NODE_ENV = "test";
      process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
      expect(() => assertServiceWorkspaceConfigured()).toThrow(/ADS_INTERNAL_WORKSPACE_ID/);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousRailwayName === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
      else process.env.RAILWAY_ENVIRONMENT_NAME = previousRailwayName;
      process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    }
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

  it("closes a stale applying job without calling the platform", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    await getDb().execute(sql`
      update os.apply_jobs
      set status = 'applying',
          attempts = 1,
          response_json = jsonb_build_object('claimedAt', now() - interval '121 seconds')
      where id = ${jobId}::uuid
    `);
    await resetEntity();
    const ran = await runApplyJob(jobId);
    expect(ran.blocked).toBe("stale_applying");
    expect(ran.writes).toBe(false);
    expect(ran.audited).toBe(true);
    const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
    expect(entity?.status).toBe("active");
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("stale_applying");
    expect(job?.attempts).toBe(1);
    expect((job?.responseJson as { writes?: unknown } | null)?.writes).toBe("unknown");
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    const staleAudits = audits.filter((row) => row.action === "apply_stale");
    expect(staleAudits).toHaveLength(1);
    expect((staleAudits[0]?.payloadJson as { writes?: unknown }).writes).toBe("unknown");
    expect(audits.some((row) => row.action === "apply_fail" || row.action === "apply_success")).toBe(false);
    const again = await runApplyJob(jobId);
    expect(again.blocked).not.toBe("in_progress");
    expect(again.writes).toBe(false);
    const after = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(after?.attempts).toBe(1);
    expect(after?.status).toBe("failed");
  });

  it("writes one apply_success when deny lands during an inline apply", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    let running: Promise<Response> | null = null;
    try {
      await locker.query("BEGIN");
      await locker.query(`SELECT id FROM os.ad_entities WHERE id = $1 FOR UPDATE`, [entityId]);
      running = Promise.resolve(
        app.request(`/recommendations/${rec.id}/apply`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ inline: true }),
        }),
      );
      const sawWait = await waitForApplyLock(locker, 4000);
      expect(sawWait).toBe(true);
      const deny = await app.request(`/recommendations/${rec.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "deny" }),
      });
      expect(deny.status).toBe(200);
      await locker.query("COMMIT");
      const res = await running;
      expect(res.status).toBe(200);
      const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
      expect(entity?.status).toBe("paused");
      const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
      expect(audits.filter((row) => row.action === "apply_success")).toHaveLength(1);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      await locker.end().catch(() => undefined);
      await running?.catch(() => undefined);
    }
  });

  it("returns in progress without a failure audit when apply is already claimed", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    await getDb().execute(sql`
      update os.apply_jobs
      set status = 'applying',
          response_json = jsonb_build_object('claimedAt', now())
      where id = ${jobId}::uuid
    `);
    const before = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    const res = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ inline: true }),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.status).toBe("in_progress");
    expect(body.ok).toBeUndefined();
    const entity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) });
    expect(entity?.status).toBe("active");
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    expect(audits.filter((row) => !before.some((rowBefore) => rowBefore.id === row.id)).map((row) => row.action)).not.toContain(
      "apply_fail",
    );
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(job?.status).toBe("applying");
    expect(job?.attempts).toBe(0);
  });

  it("returns a stored failure without another attempt or a queued response", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    await getDb()
      .update(applyJobs)
      .set({ status: "failed", error: "connector_rejected", finishedAt: new Date() })
      .where(eq(applyJobs.id, jobId));
    const stored = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    const before = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    const res = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("failed");
    expect(body.status).not.toBe("queued");
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("connector_rejected");
    expect(job?.attempts).toBe(stored?.attempts ?? 0);
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    const added = audits.filter((row) => !before.some((rowBefore) => rowBefore.id === row.id));
    expect(added.some((row) => row.action === "apply_attempt" || row.action === "apply_fail")).toBe(false);
  });

  it("requeues a failed apply for the owner and leaves the platform alone", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    await getDb()
      .update(applyJobs)
      .set({ status: "failed", error: "stale_applying", finishedAt: new Date(), attempts: 1 })
      .where(eq(applyJobs.id, jobId));
    await resetEntity();

    const email = "operator.safety@tharrosmedia.com";
    const passwordHash = await hash("operator-safety-local", 10);
    const existing = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ?? (await getDb().insert(users).values({ email, name: "Safety operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await getDb().update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await getDb().insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" }).onConflictDoNothing();
    const operatorToken = (await login(email, "operator-safety-local")).token;
    const previousAllow = process.env.APPROVE_OPERATOR_EMAILS;
    process.env.APPROVE_OPERATOR_EMAILS = "adam@tharrosmedia.com,operator.safety@tharrosmedia.com";
    try {
      const operatorRequeue = await app.request(`/recommendations/${rec.id}/apply`, {
        method: "POST",
        headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requeue: true }),
      });
      expect(operatorRequeue.status).toBe(403);
      expect(String((await json(operatorRequeue)).error)).toMatch(/owner/i);
      const serviceRequeue = await app.request(`/recommendations/${rec.id}/apply`, {
        method: "POST",
        headers: internalHeaders(true),
        body: JSON.stringify({ requeue: true }),
      });
      expect(serviceRequeue.status).toBe(403);
    } finally {
      if (previousAllow === undefined) delete process.env.APPROVE_OPERATOR_EMAILS;
      else process.env.APPROVE_OPERATOR_EMAILS = previousAllow;
    }
    expect((await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) }))?.status).toBe("failed");

    const ownerRequeue = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requeue: true }),
    });
    expect(ownerRequeue.status).toBe(200);
    const queued = await json(ownerRequeue);
    expect(queued.status).toBe("queued");
    expect(queued.writes).toBe(false);
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(job?.status).toBe("queued");
    expect(job?.error).toBeNull();
    expect(job?.finishedAt).toBeNull();
    expect(job?.attempts).toBe(1);
    expect((await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entityId) }))?.status).toBe("active");
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    expect(audits.filter((row) => row.action === "apply_requeue")).toHaveLength(1);
    expect(audits.some((row) => row.action === "apply_fail")).toBe(false);

    await getDb().update(applyJobs).set({ status: "applying" }).where(eq(applyJobs.id, jobId));
    const applying = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requeue: true }),
    });
    expect(applying.status).toBe(409);
    await getDb()
      .update(applyJobs)
      .set({ status: "succeeded", error: null, finishedAt: new Date() })
      .where(eq(applyJobs.id, jobId));
    const succeeded = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requeue: true }),
    });
    expect(succeeded.status).toBe(409);
    const replay = await app.request(`/recommendations/${rec.id}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(replay.status).toBe(200);
    expect((await json(replay)).status).toBe("succeeded");
    expect((await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) }))?.status).toBe("succeeded");
  });

  it("refuses service and operator changes that would let apply write", async () => {
    const db = getDb();
    const ownerOn = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(ownerOn.status).toBe(200);

    const serviceOff = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(serviceOff.status).toBe(403);
    expect(String((await json(serviceOff)).error)).toMatch(/owner/i);
    expect((await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(true);

    const email = "operator.safety@tharrosmedia.com";
    const passwordHash = await hash("operator-safety-local", 10);
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ?? (await db.insert(users).values({ email, name: "Safety operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await db.update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await db.insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" }).onConflictDoNothing();
    const operatorToken = (await login(email, "operator-safety-local")).token;
    const operatorOff = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(operatorOff.status).toBe(403);
    expect((await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(true);

    await db.update(adAccounts).set({ frozen: true }).where(eq(adAccounts.id, accountId));
    const serviceUnfreeze = await app.request(`/ad-accounts/${accountId}`, {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ frozen: false }),
    });
    expect(serviceUnfreeze.status).toBe(403);
    expect((await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, accountId) }))?.frozen).toBe(true);
    const operatorUnfreeze = await app.request(`/ad-accounts/${accountId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ frozen: false }),
    });
    expect(operatorUnfreeze.status).toBe(403);
    expect((await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, accountId) }))?.frozen).toBe(true);

    const serviceApply = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(true),
      body: JSON.stringify({ capabilities: { apply: "on" } }),
    });
    expect(serviceApply.status).toBe(403);
    const operatorApply = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { apply: "on" } }),
    });
    expect(operatorApply.status).toBe(403);

    const ownerOff = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false, capabilities: { apply: "on" } }),
    });
    expect(ownerOff.status).toBe(200);
    const ownerUnfreeze = await app.request(`/ad-accounts/${accountId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ frozen: false }),
    });
    expect(ownerUnfreeze.status).toBe(200);
    expect((await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, accountId) }))?.frozen).toBe(false);
    expect((await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(false);
  });

  it("keeps a 119 second claim in progress on the database clock", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    await getDb().execute(sql`
      update os.apply_jobs
      set status = 'applying',
          response_json = jsonb_build_object('claimedAt', now() - interval '119 seconds')
      where id = ${jobId}::uuid
    `);
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    const remaining = await applyingLeaseRemainingMs(job?.responseJson);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(APPLYING_LEASE_MS);
    const ran = await runApplyJob(jobId);
    expect(ran.blocked).toBe("in_progress");
    expect(ran.writes).toBe(false);
    const after = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(after?.status).toBe("applying");
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
    expect(audits.some((row) => row.action === "apply_stale" || row.action === "apply_fail")).toBe(false);
  });

  it("audits a late settle that overwrites a stale applying job", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    let running: Promise<Awaited<ReturnType<typeof runApplyJob>>> | null = null;
    try {
      await locker.query("BEGIN");
      await locker.query(`SELECT id FROM os.ad_entities WHERE id = $1 FOR UPDATE`, [entityId]);
      running = runApplyJob(jobId);
      const sawWait = await waitForApplyLock(locker, 4000);
      expect(sawWait).toBe(true);
      await getDb().execute(sql`
        update os.apply_jobs
        set response_json = jsonb_build_object('claimedAt', now() - interval '121 seconds')
        where id = ${jobId}::uuid and status = 'applying'
      `);
      const stale = await runApplyJob(jobId);
      expect(stale.blocked).toBe("stale_applying");
      expect(stale.writes).toBe(false);
      await locker.query("COMMIT");
      const settled = await running;
      expect(settled.writes).toBe(true);
      expect(settled.applyJob.status).toBe("succeeded");
      expect(settled.audited).toBe(true);
      const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, jobId));
      expect(audits.filter((row) => row.action === "apply_stale")).toHaveLength(1);
      expect((audits.find((row) => row.action === "apply_stale")?.payloadJson as { writes?: unknown }).writes).toBe(
        "unknown",
      );
      expect(audits.filter((row) => row.action === "apply_success")).toHaveLength(1);
      const success = audits.find((row) => row.action === "apply_success");
      expect((success?.payloadJson as { superseded?: string }).superseded).toBe("stale_applying");
      expect((success?.payloadJson as { writes?: unknown }).writes).toBe(true);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      await locker.end().catch(() => undefined);
      await running?.catch(() => undefined);
    }
  });

  it("refuses service and operator apply-capability ons and audits the owner", async () => {
    const db = getDb();
    const before = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!before) throw new Error("workspace missing");
    const snapshot = before.settingsJson;
    const email = "operator.safety@tharrosmedia.com";
    const passwordHash = await hash("operator-safety-local", 10);
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ?? (await db.insert(users).values({ email, name: "Safety operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await db.update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await db.insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" }).onConflictDoNothing();
    const operatorToken = (await login(email, "operator-safety-local")).token;
    const ids = applySafetyCapabilityIds();
    expect(ids).toEqual(
      expect.arrayContaining([
        "apply",
        "apply.create_entity",
        "apply.budget",
        "apply.bid",
        "m52.booked_job_signal",
        "site.wordpress.apply",
        "seo.gsc.apply",
      ]),
    );
    expect(isApplySafetyCapability("connect.meta")).toBe(false);

    try {
      for (const id of ids) {
        const hide = await app.request("/workspace", {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ capabilities: { [id]: "hidden" } }),
        });
        expect(hide.status, id).toBe(200);
        const serviceOn = await app.request("/workspace", {
          method: "PATCH",
          headers: internalHeaders(true),
          body: JSON.stringify({ capabilities: { [id]: "on" } }),
        });
        expect(serviceOn.status, id).toBe(403);
        const operatorOn = await app.request("/workspace", {
          method: "PATCH",
          headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
          body: JSON.stringify({ capabilities: { [id]: "on" } }),
        });
        expect(operatorOn.status, id).toBe(403);
        const hidden = resolveWorkspaceCapabilities(
          (await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.settingsJson,
        );
        expect(hidden[id], id).toBe("hidden");
        const ownerOn = await app.request("/workspace", {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ capabilities: { [id]: "on" } }),
        });
        expect(ownerOn.status, id).toBe(200);
        const turnedOn = resolveWorkspaceCapabilities(
          (await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.settingsJson,
        );
        expect(turnedOn[id], id).toBe("on");
        const flips = (await db.select().from(auditLog).where(eq(auditLog.entityId, workspaceId))).filter(
          (row) => row.action === "capability_flip" && (row.payloadJson as { capability?: string }).capability === id,
        );
        const refused = flips.filter((row) => (row.payloadJson as { allowed?: boolean }).allowed === false);
        const allowed = flips.filter((row) => (row.payloadJson as { allowed?: boolean }).allowed === true);
        expect(refused.some((row) => row.actorType === "service"), id).toBe(true);
        expect(refused.some((row) => row.actorType === "user"), id).toBe(true);
        expect(allowed.some((row) => row.actorType === "user" && row.actorId === ownerId), id).toBe(true);
      }
      const recommend = await app.request("/workspace", {
        method: "PATCH",
        headers: internalHeaders(true),
        body: JSON.stringify({ capabilities: { apply: "recommend_only" } }),
      });
      expect(recommend.status).toBe(200);
    } finally {
      await db.update(workspaces).set({ settingsJson: snapshot }).where(eq(workspaces.id, workspaceId));
    }
  });

  it("keeps a partial write as succeeded and hides raw SQL from job.error", () => {
    expect(settledApplyJob({ writes: true, failed: "budget failed", revoked: false })).toEqual({
      status: "succeeded",
      error: "budget failed",
    });
    expect(settledApplyJob({ writes: true, failed: "budget failed", revoked: true })).toEqual({
      status: "succeeded",
      error: "revoked_after_write",
    });
    expect(settledApplyJob({ writes: false, failed: "budget failed", revoked: false })).toEqual({
      status: "failed",
      error: "budget failed",
    });
    expect(settledApplyJob({ writes: false, failed: null, revoked: true })).toEqual({
      status: "failed",
      error: "authorization_revoked",
    });
    const sqlError = 'Failed query: update "os"."ad_entities" set "status" = $1 params: paused';
    expect(sanitizeStoredError(sqlError)).toBe("database_error");
    expect(sanitizeStoredError('duplicate key value violates unique constraint "apply_jobs_idempotency_idx"')).toBe(
      "database_error",
    );
    expect(sanitizeStoredError('insert or update on table "x" violates foreign key constraint "y"')).toBe(
      "database_error",
    );
    expect(sanitizeStoredError('new row for relation "x" violates check constraint "z"')).toBe("database_error");
    expect(sanitizeStoredError("SQLSTATE 23505")).toBe("database_error");
    const platformText = "Meta update rejected params: daily_budget";
    expect(sanitizeStoredError(platformText)).toBe(platformText);
    expect(sanitizeStoredError("authorization_revoked")).toBe("authorization_revoked");
    expect(settledApplyJob({ writes: true, failed: sqlError, revoked: false }).error).toBe("database_error");
    expect(shouldRecordApplyAudit({ blocked: "in_progress" })).toBe(false);
    expect(shouldRecordApplyAudit({ blocked: "stale_applying" })).toBe(false);
    expect(shouldRecordApplyAudit({ blocked: "revoked_after_write", audited: true })).toBe(false);
    expect(shouldRecordApplyAudit({ blocked: null, replayed: true })).toBe(false);
    expect(shouldRecordApplyAudit({ blocked: null })).toBe(true);
    expect(PLATFORM_WRITE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PLATFORM_WRITE_TIMEOUT_MS).toBeLessThan(APPLYING_LEASE_MS / 2);
    expect(APPLY_EXECUTE_DEADLINE_MS).toBeGreaterThan(PLATFORM_WRITE_TIMEOUT_MS);
    expect(APPLY_EXECUTE_DEADLINE_MS).toBeLessThan(APPLYING_LEASE_MS);
    expect(isAbortedApplyError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(true);
    expect(isAbortedApplyError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbortedApplyError(new Error("connector_rejected"))).toBe(false);
    expect(applyOutcomeWrites([{ writes: "unknown", status: "failed" }])).toBe("unknown");
    expect(applyOutcomeWrites([{ writes: false, status: "failed" }])).toBe(false);
    expect(
      applyOutcomeWrites([
        { writes: true, status: "applied" },
        { writes: "unknown", status: "failed" },
      ]),
    ).toBe(true);
  });

  it("clamps a future claimedAt to the lease and closes the stuck job", async () => {
    const rec = await insertRec();
    const jobId = await approveQueued(rec.id);
    await getDb().execute(sql`
      update os.apply_jobs
      set status = 'applying',
          response_json = jsonb_build_object('claimedAt', now() + interval '1 year')
      where id = ${jobId}::uuid
    `);
    const job = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, jobId) });
    expect(await applyingLeaseRemainingMs(job?.responseJson)).toBe(APPLYING_LEASE_MS);
    const ran = await runApplyJob(jobId);
    expect(ran.blocked).toBe("in_progress");
    expect(ran.writes).toBe(false);
    const closed = await closeApplyingJob(jobId);
    expect(closed.blocked).toBe("stale_applying");
    expect(closed.applyJob.status).toBe("failed");
    expect(closed.applyJob.error).toBe("stale_applying");
    expect((closed.applyJob.response as { writes?: unknown }).writes).toBe("unknown");
    const again = await closeApplyingJob(jobId);
    expect(again.replayed).toBe(true);
    expect(shouldRecordApplyAudit(again)).toBe(false);
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
