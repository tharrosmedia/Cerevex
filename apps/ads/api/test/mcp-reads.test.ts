import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MCP_READ_MAX_LIMIT } from "@cerevex/contracts";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { clients, mcpIdentities, workspaces } from "@tharros/ads-shared/schema";
import { app, json, login } from "./helpers";

const INTERNAL_KEY = "read-internal-key";
const MCP_KEY = "read-mcp-key";
const MISSING_CLIENT_ID = "99999999-9999-4999-8999-999999999999";

describe("mcp read façade", () => {
  let ownerToken = "";
  let workspaceId = "";
  let clientId = "";
  let ungrantedClientId = "";
  let otherClientId = "";
  let storeId = "";
  let readIdentityId = "";
  let submitIdentityId = "";
  let revokedIdentityId = "";
  const clientName = `Read grant ${Date.now().toString(36)}`;
  const original = {
    key: process.env.ADS_INTERNAL_KEY,
    mcp: process.env.MCP_SERVICE_KEY,
    workspace: process.env.ADS_INTERNAL_WORKSPACE_ID,
  };

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.MCP_SERVICE_KEY = MCP_KEY;
    ownerToken = (
      await login(process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com", process.env.SEED_OWNER_PASSWORD ?? "local-dev-only")
    ).token;
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    storeId = randomUUID();
    const [client] = await db
      .insert(clients)
      .values({ workspaceId, name: clientName, status: "active", siteId: storeId })
      .returning();
    const [ungranted] = await db
      .insert(clients)
      .values({ workspaceId, name: `${clientName} other`, status: "active" })
      .returning();
    const [otherWorkspace] = await db.insert(workspaces).values({ name: `${clientName} workspace` }).returning();
    const [otherClient] = await db
      .insert(clients)
      .values({ workspaceId: otherWorkspace!.id, name: `${clientName} foreign`, status: "active" })
      .returning();
    if (!client || !ungranted || !otherWorkspace || !otherClient) throw new Error("clients missing");
    clientId = client.id;
    ungrantedClientId = ungranted.id;
    otherClientId = otherClient.id;

    readIdentityId = await createIdentity("cerevex.read", clientId);
    submitIdentityId = await createIdentity("cerevex.recs.submit", clientId);
    revokedIdentityId = await createIdentity("cerevex.read", clientId);
    const revoked = await app.request(`/mcp/identities/${revokedIdentityId}/revoke`, {
      method: "POST",
      headers: owner(),
    });
    expect(revoked.status).toBe(200);
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) await db.delete(mcpIdentities).where(eq(mcpIdentities.workspaceId, workspaceId));
    for (const id of [clientId, ungrantedClientId]) {
      if (id) await db.delete(clients).where(eq(clients.id, id));
    }
    if (otherClientId) await db.delete(clients).where(eq(clients.id, otherClientId));
    if (original.key === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = original.key;
    if (original.mcp === undefined) delete process.env.MCP_SERVICE_KEY;
    else process.env.MCP_SERVICE_KEY = original.mcp;
    if (original.workspace === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = original.workspace;
    await closeDb();
  });

  function owner(jsonBody = false): Record<string, string> {
    return {
      authorization: `Bearer ${ownerToken}`,
      ...(jsonBody ? { "content-type": "application/json" } : {}),
    };
  }

  async function createIdentity(scope: "cerevex.read" | "cerevex.recs.submit", grantedClientId: string) {
    const name = `r${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const created = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ name, scopes: [scope], clientIds: [grantedClientId] }),
    });
    expect(created.status).toBe(200);
    const body = await json(created);
    return String((body.identity as { id: string }).id);
  }

  function readBody(tool: string, identityId: string, targetClientId: string, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      tool,
      identityId,
      clientId: targetClientId,
      limit: 10,
      cursor: null,
      ...extra,
    });
  }

  async function postRead(body: string, headers: Record<string, string> = { "x-cerevex-mcp-key": MCP_KEY }) {
    return app.request("/internal/mcp/read", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }

  it("refuses the Brain key, an owner session, and a query-string key", async () => {
    const body = readBody("get_store_catalog", readIdentityId, clientId);
    const brain = await postRead(body, { "x-cerevex-internal-key": INTERNAL_KEY });
    const ownerCall = await postRead(body, { authorization: `Bearer ${ownerToken}` });
    const query = await app.request(`/internal/mcp/read?x-cerevex-mcp-key=${MCP_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(brain.status).toBe(401);
    expect(ownerCall.status).toBe(401);
    expect(query.status).toBe(401);
  });

  it("uses one denial for an ungranted client, a missing client, a foreign client, and a revoked identity", async () => {
    const cases = [
      readBody("get_store_catalog", readIdentityId, ungrantedClientId),
      readBody("get_store_catalog", readIdentityId, MISSING_CLIENT_ID),
      readBody("get_store_catalog", readIdentityId, otherClientId),
      readBody("get_store_catalog", revokedIdentityId, clientId),
    ];
    const texts: string[] = [];
    for (const body of cases) {
      const res = await postRead(body);
      expect(res.status).toBe(404);
      texts.push(await res.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(JSON.stringify({ ok: false }));
    expect(texts[0]).not.toContain(clientName);
    expect(texts[0]).not.toContain(clientId);
  });

  it("returns 403 for a submit-only identity without naming the client", async () => {
    const res = await postRead(readBody("get_seo_findings", submitIdentityId, clientId, { status: "open" }));
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("insufficient_scope");
    expect(text).not.toContain(clientId);
    expect(text).not.toContain(clientName);
  });

  it("rejects an over-cap limit and a Search Console window past 28 days", async () => {
    const over = await postRead(
      readBody("get_gsc_performance", readIdentityId, clientId, {
        limit: MCP_READ_MAX_LIMIT + 1,
        dateStart: "2026-09-19",
        dateEnd: "2026-10-16",
        view: "both",
      }),
    );
    expect(over.status).toBe(400);
    const wide = await postRead(
      readBody("get_gsc_performance", readIdentityId, clientId, {
        dateStart: "2026-01-01",
        dateEnd: "2026-01-29",
        view: "queries",
      }),
    );
    expect(wide.status).toBe(400);
    expect(await over.text()).toBe(await wide.text());
  });

  it("returns a not-synced stub for each granted read", async () => {
    const calls: Array<{ tool: string; extra: Record<string, unknown>; rows: string[] }> = [
      {
        tool: "get_gsc_performance",
        extra: { dateStart: "2026-09-19", dateEnd: "2026-10-16", view: "both" },
        rows: ["queries", "pages"],
      },
      { tool: "get_seo_findings", extra: { status: "open" }, rows: ["findings"] },
      { tool: "get_store_catalog", extra: {}, rows: ["products", "collections"] },
    ];
    for (const call of calls) {
      const res = await postRead(readBody(call.tool, readIdentityId, clientId, { limit: MCP_READ_MAX_LIMIT, ...call.extra }));
      expect(res.status, call.tool).toBe(200);
      const body = await json(res);
      const read = body.read as Record<string, unknown>;
      expect(read).toMatchObject({
        clientId,
        storeId,
        lastSyncedAt: null,
        sourceSystem: "stub",
        availability: "not_synced",
        limit: MCP_READ_MAX_LIMIT,
        nextCursor: null,
      });
      for (const key of call.rows) expect(read[key]).toEqual([]);
      const text = JSON.stringify(body);
      expect(text).not.toContain(clientName);
      expect(text).not.toContain("bodyHtml");
      expect(text).not.toContain("ga4");
    }
  });
});
