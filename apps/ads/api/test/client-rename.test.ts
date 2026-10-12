import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clientMemberships, clients, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

const INTERNAL_KEY = "cs3-client-rename-internal-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;
const ORIGINAL_WORKSPACE = process.env.ADS_INTERNAL_WORKSPACE_ID;
const marker = `cs3-${Date.now().toString(36)}`;

describe("PATCH /clients/:id rename and site link at add", () => {
  let ownerToken = "";
  let operatorToken = "";
  let readonlyToken = "";
  let workspaceId = "";
  let ownerId = "";
  let operatorId = "";
  let otherWorkspaceId = "";
  let otherClientId = "";
  const createdIds: string[] = [];
  const siteNew = `cs3-site-new-${marker}`;
  const siteAdopt = `cs3-site-adopt-${marker}`;
  const hvacName = `HVAC USA ${marker}`;
  const adoptName = `KC Prestige HVAC ${marker}`;

  const owner = () => ({ authorization: `Bearer ${ownerToken}`, "content-type": "application/json" });
  const operator = () => ({ authorization: `Bearer ${operatorToken}`, "content-type": "application/json" });

  async function clientRow(id: string) {
    const row = await getDb().query.clients.findFirst({ where: eq(clients.id, id) });
    if (!row) throw new Error(`client ${id} missing`);
    return row;
  }

  async function renamedAudits(id: string) {
    return getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "client.renamed"), eq(auditLog.entityId, id)));
  }

  beforeAll(async () => {
    const { workspace } = await ensureScopedUser();
    workspaceId = workspace.id;
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    readonlyToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;
    const ownerUser = await getDb().query.users.findFirst({
      where: eq(users.email, (process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com").toLowerCase()),
    });
    if (!ownerUser) throw new Error("Seed owner missing");
    ownerId = ownerUser.id;

    const email = "cs3.rename.operator@tharrosmedia.com";
    const passwordHash = await hash("cs3-rename-operator", 10);
    const db = getDb();
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const operatorUser =
      existing ??
      (await db.insert(users).values({ email, name: "CS3 rename operator", passwordHash }).returning())[0];
    if (!operatorUser) throw new Error("operator missing");
    if (existing) await db.update(users).set({ passwordHash }).where(eq(users.id, operatorUser.id));
    await db
      .insert(memberships)
      .values({ userId: operatorUser.id, workspaceId, role: "operator" })
      .onConflictDoNothing();
    operatorId = operatorUser.id;
    operatorToken = (await login(email, "cs3-rename-operator")).token;

    const [otherWs] = await db.insert(workspaces).values({ name: `CS3 other ${marker}` }).returning();
    if (!otherWs) throw new Error("other workspace missing");
    otherWorkspaceId = otherWs.id;
    const [otherClient] = await db
      .insert(clients)
      .values({ workspaceId: otherWorkspaceId, name: `Other ${marker}`, status: "active" })
      .returning();
    if (!otherClient) throw new Error("other client missing");
    otherClientId = otherClient.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (createdIds.length) {
      await db.delete(auditLog).where(and(eq(auditLog.action, "client.renamed"), inArray(auditLog.entityId, createdIds)));
      await db.delete(auditLog).where(and(eq(auditLog.action, "client.created_for_site"), inArray(auditLog.entityId, createdIds)));
      await db.delete(auditLog).where(and(eq(auditLog.action, "client.site_linked"), inArray(auditLog.entityId, createdIds)));
      await db.delete(clients).where(inArray(clients.id, createdIds));
    }
    await db.delete(clients).where(like(clients.name, `%${marker}%`));
    // audit_log refuses deletes, so a workspace that cascade-cleans that table cannot be removed here.
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
    if (ORIGINAL_WORKSPACE === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = ORIGINAL_WORKSPACE;
    await closeDb();
  });

  it("creates a named ads client linked to the new site, and adopts an unlinked same name", async () => {
    const created = await app.request(`/sites/${siteNew}/client`, {
      method: "PUT",
      headers: owner(),
      body: JSON.stringify({ name: hvacName }),
    });
    expect(created.status).toBe(200);
    const body = await json(created);
    const client = body.client as { id: string; name: string; siteId: string; workspaceId: string };
    expect(body.created).toBe(true);
    expect(body.adopted).toBe(false);
    expect(client.name).toBe(hvacName);
    expect(client.siteId).toBe(siteNew);
    expect(client.workspaceId).toBe(workspaceId);
    createdIds.push(client.id);

    const row = await clientRow(client.id);
    expect(row.name).toBe(hvacName);
    expect(row.siteId).toBe(siteNew);
    const createdAudit = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "client.created_for_site"), eq(auditLog.entityId, client.id)));
    expect(createdAudit).toHaveLength(1);
    expect(createdAudit[0]?.payloadJson).toMatchObject({ siteId: siteNew });

    const again = await app.request(`/sites/${siteNew}/client`, {
      method: "PUT",
      headers: owner(),
      body: JSON.stringify({ name: "A different name" }),
    });
    expect(again.status).toBe(200);
    const againBody = await json(again);
    expect(againBody.created).toBe(false);
    expect((againBody.client as { id: string; name: string }).id).toBe(client.id);
    expect((againBody.client as { name: string }).name).toBe(hvacName);
    expect((await clientRow(client.id)).name).toBe(hvacName);

    const [unlinked] = await getDb()
      .insert(clients)
      .values({ workspaceId, name: adoptName, status: "active", siteId: null })
      .returning();
    if (!unlinked) throw new Error("unlinked client missing");
    createdIds.push(unlinked.id);
    const beforeCount = await getDb().select().from(clients).where(eq(clients.name, adoptName));
    const adopted = await app.request(`/sites/${siteAdopt}/client`, {
      method: "PUT",
      headers: owner(),
      body: JSON.stringify({ name: adoptName.toLowerCase() }),
    });
    expect(adopted.status).toBe(200);
    const adoptedBody = await json(adopted);
    expect(adoptedBody.adopted).toBe(true);
    expect(adoptedBody.created).toBe(false);
    expect((adoptedBody.client as { id: string; siteId: string; name: string }).id).toBe(unlinked.id);
    expect((adoptedBody.client as { siteId: string }).siteId).toBe(siteAdopt);
    expect((adoptedBody.client as { name: string }).name).toBe(adoptName);
    const after = await getDb().select().from(clients).where(eq(clients.workspaceId, workspaceId));
    expect(after.filter((row) => row.name.toLowerCase() === adoptName.toLowerCase())).toHaveLength(beforeCount.length);
  });

  it("refuses the service key on create and link and writes nothing", async () => {
    const before = await getDb().select().from(clients).where(eq(clients.workspaceId, workspaceId));
    const service = await app.request(`/sites/cs3-service-${marker}/client`, {
      method: "PUT",
      headers: { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" },
      body: JSON.stringify({ name: `Service ${marker}` }),
    });
    expect(service.status).toBe(403);
    expect((await json(service)).error).toBe("Owner or operator role required");
    const both = await app.request(`/sites/cs3-service-both-${marker}/client`, {
      method: "PUT",
      headers: {
        "x-cerevex-internal-key": INTERNAL_KEY,
        authorization: `Bearer ${ownerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: `Service both ${marker}` }),
    });
    expect(both.status).toBe(403);
    const link = await app.request(`/clients/${createdIds[0]}/site`, {
      method: "POST",
      headers: { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" },
      body: JSON.stringify({ siteId: `cs3-link-${marker}` }),
    });
    expect(link.status).toBe(403);
    const after = await getDb().select().from(clients).where(eq(clients.workspaceId, workspaceId));
    expect(after.map((row) => `${row.id}:${row.name}:${row.siteId}`).sort()).toEqual(
      before.map((row) => `${row.id}:${row.name}:${row.siteId}`).sort(),
    );
  });

  it("renames for an owner or operator, writes client.renamed, and leaves the site linked", async () => {
    const id = createdIds[0];
    if (!id) throw new Error("created client missing");
    const before = await clientRow(id);
    const next = `HVAC USA North ${marker}`;
    const res = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: owner(),
      body: JSON.stringify({ name: `  ${next}  `, businessType: "ecommerce" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.client as { name: string; siteId: string; plan: string }).name).toBe(next);
    expect((body.client as { siteId: string }).siteId).toBe(before.siteId);
    expect((body.client as { plan: string }).plan).toBe(before.plan);
    const row = await clientRow(id);
    expect(row.name).toBe(next);
    expect(row.siteId).toBe(before.siteId);
    expect(row.plan).toBe(before.plan);
    const audits = await renamedAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "user", actorId: ownerId, entityType: "client" });
    expect(audits[0]?.payloadJson).toEqual({ from: before.name, to: next });

    const same = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: owner(),
      body: JSON.stringify({ name: next }),
    });
    expect(same.status).toBe(200);
    expect(await renamedAudits(id)).toHaveLength(1);

    const operatorNext = `HVAC USA West ${marker}`;
    const byOperator = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: operator(),
      body: JSON.stringify({ name: operatorNext }),
    });
    expect(byOperator.status).toBe(200);
    expect((await clientRow(id)).name).toBe(operatorNext);
    const operatorAudits = await renamedAudits(id);
    expect(operatorAudits).toHaveLength(2);
    expect(operatorAudits.find((audit) => (audit.payloadJson as { to?: string }).to === operatorNext)).toMatchObject({
      actorId: operatorId,
      actorType: "user",
    });
  });

  it("refuses a taken name, a blank name, a long name, a read-only session, and the service key", async () => {
    const id = createdIds[0];
    if (!id) throw new Error("created client missing");
    const takenId = createdIds[1];
    if (!takenId) throw new Error("adopted client missing");
    const taken = await clientRow(takenId);
    const current = await clientRow(id);
    const auditsBefore = await renamedAudits(id);

    const clash = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: owner(),
      body: JSON.stringify({ name: taken.name.toLowerCase() }),
    });
    expect(clash.status).toBe(409);
    expect((await json(clash)).error).toBe(`There's already a client called ${taken.name}.`);
    expect((await clientRow(id)).name).toBe(current.name);
    expect(await renamedAudits(id)).toHaveLength(auditsBefore.length);

    for (const body of [{}, { name: "   " }, { name: "" }, { name: 12 }, null]) {
      const res = await app.request(`/clients/${id}`, {
        method: "PATCH",
        headers: owner(),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe("Enter a client name.");
    }
    const longName = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: owner(),
      body: JSON.stringify({ name: "x".repeat(201) }),
    });
    expect(longName.status).toBe(400);
    expect((await json(longName)).error).toBe("Client name is too long.");
    expect((await clientRow(id)).name).toBe(current.name);

    const readonlyUser = await getDb().query.users.findFirst({
      where: eq(users.email, "pilot.readonly@tharrosmedia.com"),
    });
    if (!readonlyUser) throw new Error("readonly user missing");
    await getDb()
      .insert(clientMemberships)
      .values({ userId: readonlyUser.id, clientId: id, role: "client_readonly" })
      .onConflictDoNothing();
    const readonly = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${readonlyToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `Readonly ${marker}` }),
    });
    expect(readonly.status).toBe(403);
    expect((await json(readonly)).error).toBe("Owner or operator role required");

    const service = await app.request(`/clients/${id}`, {
      method: "PATCH",
      headers: { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" },
      body: JSON.stringify({ name: `Service rename ${marker}` }),
    });
    expect(service.status).toBe(403);
    expect((await json(service)).error).toBe("Owner or operator role required");
    expect((await clientRow(id)).name).toBe(current.name);
    expect(await renamedAudits(id)).toHaveLength(auditsBefore.length);

    const removed = await app.request(`/clients/${id}`, { method: "DELETE", headers: owner() });
    expect(removed.status).toBe(404);
    expect((await clientRow(id)).name).toBe(current.name);
  });

  it("denies a rename of another workspace's client and leaves it unchanged", async () => {
    const before = await clientRow(otherClientId);
    const res = await app.request(`/clients/${otherClientId}`, {
      method: "PATCH",
      headers: owner(),
      body: JSON.stringify({ name: `Stolen ${marker}` }),
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("Client not found");
    expect((await clientRow(otherClientId)).name).toBe(before.name);
    expect(await renamedAudits(otherClientId)).toHaveLength(0);

    const operatorRes = await app.request(`/clients/${otherClientId}`, {
      method: "PATCH",
      headers: operator(),
      body: JSON.stringify({ name: `Stolen operator ${marker}` }),
    });
    expect(operatorRes.status).toBe(404);
    expect((await clientRow(otherClientId)).name).toBe(before.name);
  });
});
