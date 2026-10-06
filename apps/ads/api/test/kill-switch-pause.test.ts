import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, getPool } from "@tharros/ads-shared/db";
import { auditLog, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { app, json, login } from "./helpers";

const INTERNAL_KEY = "test-internal-service-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;
const ORIGINAL_WORKSPACE = process.env.ADS_INTERNAL_WORKSPACE_ID;

describe("workspace apply kill switch from Brain's pause path", () => {
  let ownerToken = "";
  let operatorToken = "";
  let workspaceId = "";
  let ownerId = "";

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    const owner = await db.query.users.findFirst({
      where: eq(users.email, process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com"),
    });
    if (!owner) throw new Error("Seed owner missing");
    ownerId = owner.id;

    const email = "pause.operator@tharrosmedia.com";
    const passwordHash = await hash("pause-operator-local", 10);
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ?? (await db.insert(users).values({ email, name: "Pause operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await db.update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await db.insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" }).onConflictDoNothing();
    operatorToken = (await login(email, "pause-operator-local")).token;

    const paused = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(paused.status).toBe(200);
  });

  afterAll(async () => {
    if (ownerToken) {
      await app.request("/workspace", {
        method: "PATCH",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ applyKillSwitch: true }),
      });
    }
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
    if (ORIGINAL_WORKSPACE === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = ORIGINAL_WORKSPACE;
    await closeDb();
  });

  function internalHeaders(): Record<string, string> {
    return { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" };
  }

  async function killRows() {
    return getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "kill_flip")));
  }

  it("lets the owner turn pause off, records old and new, and ignores a repeat", async () => {
    const primed = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(primed.status).toBe(200);
    const before = await killRows();
    const off = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(off.status).toBe(200);
    expect((await json(off)).workspace).toMatchObject({ applyKillSwitch: false });
    const afterOff = await killRows();
    expect(afterOff.length).toBe(before.length + 1);
    const row = afterOff.find((item) => !before.some((prior) => prior.id === item.id));
    expect(row?.actorType).toBe("user");
    expect(row?.actorId).toBe(ownerId);
    expect(row?.payloadJson).toMatchObject({ old: true, new: false, actor: ownerId, applyKillSwitch: false });

    const again = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(again.status).toBe(200);
    expect((await killRows()).length).toBe(afterOff.length);
    expect((await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(
      false,
    );
  });

  it("lets an operator and the service key pause, and refuses both from turning pause off", async () => {
    const open = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(open.status).toBe(200);
    const beforePauseIds = new Set((await killRows()).map((row) => row.id));
    const pause = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(pause.status).toBe(200);
    const pausedRows = (await killRows()).filter((row) => !beforePauseIds.has(row.id));
    expect(pausedRows).toHaveLength(1);
    expect(pausedRows[0]?.payloadJson).toMatchObject({ old: false, new: true, applyKillSwitch: true });

    const operatorOff = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(operatorOff.status).toBe(403);

    const serviceOff = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(),
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(serviceOff.status).toBe(403);
    expect((await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(
      true,
    );

    const ownerOff = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(ownerOff.status).toBe(200);
    const beforeServiceIds = new Set((await killRows()).map((row) => row.id));
    const serviceOn = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(),
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(serviceOn.status).toBe(200);
    const serviceRows = (await killRows()).filter((row) => !beforeServiceIds.has(row.id));
    expect(serviceRows).toHaveLength(1);
    expect(serviceRows[0]?.actorType).toBe("service");
    expect(serviceRows[0]?.actorId).toBeNull();
    expect(serviceRows[0]?.payloadJson).toMatchObject({
      old: false,
      new: true,
      actor: "service",
      applyKillSwitch: true,
    });
  });

  it("refuses a workspace the caller is not in", async () => {
    const before = (await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch;
    const other = "33333333-3333-4333-8333-333333333333";
    const res = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: other, applyKillSwitch: false }),
    });
    expect(res.status).toBe(404);
    const serviceOther = await app.request("/workspace", {
      method: "PATCH",
      headers: internalHeaders(),
      body: JSON.stringify({ workspaceId: other, applyKillSwitch: false }),
    });
    expect(serviceOther.status).toBe(404);
    expect((await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(
      before,
    );
  });

  it("writes one kill_flip for parallel unpauses and one for parallel pauses", async () => {
    const primed = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(primed.status).toBe(200);
    const beforeOff = new Set((await killRows()).map((row) => row.id));
    const offs = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request("/workspace", {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ applyKillSwitch: false }),
        }),
      ),
    );
    expect(offs.every((res) => res.status === 200)).toBe(true);
    const offRows = (await killRows()).filter((row) => !beforeOff.has(row.id));
    expect(offRows).toHaveLength(1);
    expect(offRows[0]?.payloadJson).toMatchObject({ old: true, new: false });
    expect((await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(
      false,
    );

    const beforeOn = new Set((await killRows()).map((row) => row.id));
    const ons = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request("/workspace", {
          method: "PATCH",
          headers: internalHeaders(),
          body: JSON.stringify({ applyKillSwitch: true }),
        }),
      ),
    );
    expect(ons.every((res) => res.status === 200)).toBe(true);
    const onRows = (await killRows()).filter((row) => !beforeOn.has(row.id));
    expect(onRows).toHaveLength(1);
    expect(onRows[0]?.payloadJson).toMatchObject({ old: false, new: true, actor: "service" });
    expect((await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(
      true,
    );
  });

  it("rolls the switch back when the kill_flip insert fails", async () => {
    const primed = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
    expect(primed.status).toBe(200);
    const before = await killRows();
    const pool = getPool();
    await pool.query(`
      CREATE OR REPLACE FUNCTION os.fail_kill_flip_test() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.action = 'kill_flip' THEN
          RAISE EXCEPTION 'forced kill_flip failure';
        END IF;
        RETURN NEW;
      END;
      $fn$
    `);
    await pool.query("DROP TRIGGER IF EXISTS fail_kill_flip_test ON os.audit_log");
    await pool.query(`
      CREATE TRIGGER fail_kill_flip_test
      BEFORE INSERT ON os.audit_log
      FOR EACH ROW EXECUTE FUNCTION os.fail_kill_flip_test()
    `);
    try {
      const off = await app.request("/workspace", {
        method: "PATCH",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ applyKillSwitch: false }),
      });
      expect(off.status).toBe(500);
      expect((await killRows()).length).toBe(before.length);
      expect((await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.applyKillSwitch).toBe(
        true,
      );
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS fail_kill_flip_test ON os.audit_log");
      await pool.query("DROP FUNCTION IF EXISTS os.fail_kill_flip_test()");
    }
  });
});
