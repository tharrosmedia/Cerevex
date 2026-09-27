import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { loadTokens } from "@tharros/ads-shared/credentials";
import { adAccounts, clients, oauthPendingConnections } from "@tharros/ads-shared/schema";
import { createPendingConnection } from "../src/pending-connect";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const SITE_A = "site-test-adopt";
const SITE_B = "site-test-new";

describe("site-owned ads clients", () => {
  let ownerToken = "";
  let scopedToken = "";
  let workspaceId = "";
  let gotDuctlessId = "";
  let ownerUserId = "";

  const owner = () => ({ authorization: `Bearer ${ownerToken}`, "content-type": "application/json" });

  beforeAll(async () => {
    const { workspace, gotDuctless } = await ensureScopedUser();
    workspaceId = workspace.id;
    gotDuctlessId = gotDuctless.id;
    ownerToken = (
      await login(process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com", process.env.SEED_OWNER_PASSWORD ?? "local-dev-only")
    ).token;
    scopedToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;
    const me = await json(await app.request("/auth/me", { headers: owner() }));
    ownerUserId = String((me.user as { id: string }).id);
  });

  afterAll(async () => {
    const db = getDb();
    const created = await db.select({ id: clients.id }).from(clients).where(like(clients.name, "Got Ductless (%"));
    if (created.length) await db.delete(clients).where(inArray(clients.id, created.map((c) => c.id)));
    await db.update(clients).set({ siteId: null }).where(eq(clients.id, gotDuctlessId));
    await db.delete(adAccounts).where(like(adAccounts.externalId, "act_site_test_%"));
    await closeDb();
  });

  it("adopts an unlinked client with the same name, then returns it again", async () => {
    const first = await app.request(`/sites/${SITE_A}/client`, {
      method: "PUT",
      headers: owner(),
      body: JSON.stringify({ name: "got ductless" }),
    });
    expect(first.status).toBe(200);
    const body = await json(first);
    const client = body.client as { id: string; siteId: string; name: string };
    expect(body.adopted).toBe(true);
    expect(client.id).toBe(gotDuctlessId);
    expect(client.siteId).toBe(SITE_A);

    const again = await json(
      await app.request(`/sites/${SITE_A}/client`, { method: "PUT", headers: owner(), body: JSON.stringify({ name: "Renamed store" }) }),
    );
    expect((again.client as { id: string }).id).toBe(gotDuctlessId);
    expect(again.created).toBe(false);
    expect(again.adopted).toBe(false);
  });

  it("creates a new client for a new site without colliding on name", async () => {
    const res = await app.request(`/sites/${SITE_B}/client`, {
      method: "PUT",
      headers: owner(),
      body: JSON.stringify({ name: "Got Ductless" }),
    });
    const body = await json(res);
    const client = body.client as { id: string; siteId: string; name: string; workspaceId: string };
    expect(body.created).toBe(true);
    expect(client.name).toBe("Got Ductless (2)");
    expect(client.siteId).toBe(SITE_B);
    expect(client.workspaceId).toBe(workspaceId);

    const list = await json(await app.request("/clients", { headers: owner() }));
    const listed = (list.clients as { id: string; siteId: string | null }[]).find((c) => c.id === client.id);
    expect(listed?.siteId).toBe(SITE_B);
  });

  it("refuses to link a site that already belongs to another client", async () => {
    const kc = (await getDb().query.clients.findFirst({ where: eq(clients.name, "KC Prestige") }))!;
    const res = await app.request(`/clients/${kc.id}/site`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ siteId: SITE_A }),
    });
    expect(res.status).toBe(409);
    const unlink = await app.request(`/clients/${kc.id}/site`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ siteId: null }),
    });
    expect(unlink.status).toBe(200);
  });

  it("does not let read-only members create site clients", async () => {
    const res = await app.request(`/sites/site-test-readonly/client`, {
      method: "PUT",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(403);
  });

  it("lets the owner choose which accounts to connect after authorizing", async () => {
    const pendingId = await createPendingConnection({
      workspaceId,
      clientId: gotDuctlessId,
      platform: "meta",
      userId: ownerUserId,
      tokens: { accessToken: "site-test-secret-token", scopes: [], mock: true },
      accounts: [
        { externalId: "act_site_test_1", name: "Got Ductless — Main", currency: "USD", detail: "Got Ductless LLC" },
        { externalId: "act_site_test_2", name: "Other business", currency: "USD", detail: "Other LLC" },
        { externalId: "act_site_test_3", name: "Managed account", currency: "USD", detail: null, loginCustomerId: "999" },
      ],
    });

    const view = await app.request(`/oauth/pending/${pendingId}`, { headers: owner() });
    expect(view.status).toBe(200);
    const text = await view.text();
    expect(text).not.toContain("site-test-secret-token");
    const listed = JSON.parse(text) as { accounts: { externalId: string; alreadyConnected: boolean }[]; client: { id: string } };
    expect(listed.client.id).toBe(gotDuctlessId);
    expect(listed.accounts.map((a) => a.externalId)).toEqual(["act_site_test_1", "act_site_test_2", "act_site_test_3"]);
    expect(listed.accounts.every((a) => !a.alreadyConnected)).toBe(true);

    const scoped = await app.request(`/oauth/pending/${pendingId}/select`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ externalIds: ["act_site_test_1"] }),
    });
    expect(scoped.status).toBe(403);

    const select = await app.request(`/oauth/pending/${pendingId}/select`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ externalIds: ["act_site_test_1", "act_site_test_3", "act_not_offered"] }),
    });
    expect(select.status).toBe(200);
    expect((await json(select)).connected).toBe(2);

    const rows = await getDb().select().from(adAccounts).where(like(adAccounts.externalId, "act_site_test_%"));
    expect(rows.map((r) => r.externalId).sort()).toEqual(["act_site_test_1", "act_site_test_3"]);
    expect(rows.find((r) => r.externalId === "act_site_test_1")?.displayName).toBe("Got Ductless — Main");
    const managed = rows.find((r) => r.externalId === "act_site_test_3")!;
    expect((await loadTokens(managed.id))?.loginCustomerId).toBe("999");
    expect((await loadTokens(rows.find((r) => r.externalId === "act_site_test_1")!.id))?.loginCustomerId).toBeUndefined();

    const gone = await app.request(`/oauth/pending/${pendingId}`, { headers: owner() });
    expect(gone.status).toBe(404);
  });

  it("rejects expired pending connections", async () => {
    const pendingId = await createPendingConnection({
      workspaceId,
      clientId: gotDuctlessId,
      platform: "google",
      userId: ownerUserId,
      tokens: { accessToken: "x", mock: true },
      accounts: [{ externalId: "123", name: "A" }],
    });
    await getDb()
      .update(oauthPendingConnections)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthPendingConnections.id, pendingId));
    const res = await app.request(`/oauth/pending/${pendingId}`, { headers: owner() });
    expect(res.status).toBe(404);
    expect((await app.request(`/oauth/pending/not-a-uuid`, { headers: owner() })).status).toBe(404);
  });
});
