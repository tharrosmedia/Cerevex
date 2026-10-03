import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { runApplyJob } from "@tharros/ads-shared/apply";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import {
  adEntities,
  applyJobs,
  auditLog,
  authorizations,
  decisions,
  recommendations,
} from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const INTERNAL_KEY = "test-internal-service-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;

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
  });

  afterAll(async () => {
    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
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
