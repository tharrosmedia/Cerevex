import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MCP_BRAIN_READ_CALLER, MCP_READ_MAX_LIMIT } from "@cerevex/contracts";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { clients, mcpIdentities, mcpIdentityGrants, workspaces } from "@tharros/ads-shared/schema";
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
  let peerIdentityId = "";
  let foreignIdentityId = "";
  let submitIdentityId = "";
  let revokedIdentityId = "";
  const clientName = `Read grant ${Date.now().toString(36)}`;
  const original = {
    key: process.env.ADS_INTERNAL_KEY,
    mcp: process.env.MCP_SERVICE_KEY,
    workspace: process.env.ADS_INTERNAL_WORKSPACE_ID,
    console: process.env.CONSOLE_ORIGIN,
    fetch: globalThis.fetch,
  };
  let brainMode: "ok" | "deny" = "ok";
  const brainCalls: string[] = [];

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.MCP_SERVICE_KEY = MCP_KEY;
    process.env.CONSOLE_ORIGIN = "http://brain.test";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      brainCalls.push(href);
      expect(init?.method).toBe("GET");
      expect(href).not.toContain(INTERNAL_KEY);
      expect(href).not.toContain(MCP_KEY);
      const headers = new Headers(init?.headers);
      expect(headers.get("x-cerevex-internal-key")).toBe(INTERNAL_KEY);
      expect(headers.get("x-cerevex-caller")).toBe(MCP_BRAIN_READ_CALLER);
      if (brainMode === "deny") return new Response(JSON.stringify({ ok: false }), { status: 403 });
      const url = new URL(href);
      return new Response(JSON.stringify({ ok: true, read: brainPayload(url) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
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
    peerIdentityId = await createIdentity("cerevex.read", ungrantedClientId);
    submitIdentityId = await createIdentity("cerevex.recs.submit", clientId);
    revokedIdentityId = await createIdentity("cerevex.read", clientId);
    const foreignName = `f${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const [foreign] = await db
      .insert(mcpIdentities)
      .values({
        workspaceId: otherWorkspace!.id,
        name: foreignName,
        displayName: foreignName,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        scopes: ["cerevex.read"],
      })
      .returning();
    if (!foreign) throw new Error("foreign identity missing");
    foreignIdentityId = foreign.id;
    await db.insert(mcpIdentityGrants).values([
      { identityId: readIdentityId, clientId: otherClientId },
      { identityId: foreignIdentityId, clientId },
    ]);
    const revoked = await app.request(`/mcp/identities/${revokedIdentityId}/revoke`, {
      method: "POST",
      headers: owner(),
    });
    expect(revoked.status).toBe(200);
  });

  afterAll(async () => {
    const db = getDb();
    if (foreignIdentityId) await db.delete(mcpIdentities).where(eq(mcpIdentities.id, foreignIdentityId));
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
    if (original.console === undefined) delete process.env.CONSOLE_ORIGIN;
    else process.env.CONSOLE_ORIGIN = original.console;
    globalThis.fetch = original.fetch;
    await closeDb();
  });

  function brainPayload(url: URL): Record<string, unknown> {
    const tool = url.searchParams.get("tool");
    const read: Record<string, unknown> = {
      clientId: url.searchParams.get("clientId"),
      storeId,
      lastSyncedAt: null,
      sourceSystem: "brain",
      availability: "ready",
      limit: Number(url.searchParams.get("limit")),
      nextCursor: null,
      token: INTERNAL_KEY,
      bodyHtml: "<p>secret</p>",
    };
    if (tool === "get_gsc_performance") {
      read.dateStart = url.searchParams.get("dateStart");
      read.dateEnd = url.searchParams.get("dateEnd");
      read.view = url.searchParams.get("view");
      read.queries = [
        { query: "person@example.com", clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
        { query: "heat pump", clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
      ];
      read.pages = [{ page: "https://example.com/heat", clicks: 1, impressions: 4, ctr: 0.25, position: 2 }];
      return read;
    }
    if (tool === "get_seo_findings") {
      read.status = url.searchParams.get("status");
      read.findings = [];
      return read;
    }
    read.products = [];
    read.collections = [];
    return read;
  }

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
      body: JSON.stringify({ displayName: name, scopes: [scope], clientIds: [grantedClientId] }),
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
    const before = brainCalls.length;
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
    expect(brainCalls.length).toBe(before);
  });

  it("does not let one identity read a client granted only to another", async () => {
    const stolen = await postRead(readBody("get_store_catalog", peerIdentityId, clientId));
    const own = await postRead(readBody("get_store_catalog", peerIdentityId, ungrantedClientId));
    const holder = await postRead(readBody("get_store_catalog", readIdentityId, clientId));
    expect(stolen.status).toBe(404);
    expect(await stolen.text()).toBe(JSON.stringify({ ok: false }));
    expect(own.status).toBe(200);
    expect((await json(own)).read).toMatchObject({ clientId: ungrantedClientId });
    expect(holder.status).toBe(200);
    expect((await json(holder)).read).toMatchObject({ clientId });
  });

  it("does not honor a grant whose client sits in another workspace", async () => {
    const res = await postRead(readBody("get_store_catalog", readIdentityId, otherClientId));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(JSON.stringify({ ok: false }));
  });

  it("does not accept an identity that belongs to another workspace", async () => {
    const res = await postRead(readBody("get_store_catalog", foreignIdentityId, clientId));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(JSON.stringify({ ok: false }));
  });

  it("rejects an extra field on an otherwise valid read", async () => {
    const res = await postRead(readBody("get_store_catalog", readIdentityId, clientId, { apply: true }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(JSON.stringify({ ok: false }));
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

  it("returns a Brain read for each granted tool and drops source PII", async () => {
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
      const before = brainCalls.length;
      const res = await postRead(readBody(call.tool, readIdentityId, clientId, { limit: MCP_READ_MAX_LIMIT, ...call.extra }));
      expect(res.status, call.tool).toBe(200);
      expect(brainCalls.length).toBe(before + 1);
      expect(brainCalls.at(-1)).toContain("http://brain.test/api/internal/mcp/read");
      const body = await json(res);
      const read = body.read as Record<string, unknown>;
      expect(read).toMatchObject({
        clientId,
        storeId,
        lastSyncedAt: null,
        sourceSystem: "brain",
        availability: "ready",
        limit: MCP_READ_MAX_LIMIT,
        nextCursor: null,
      });
      if (call.tool === "get_gsc_performance") {
        expect(read.queries).toEqual([{ query: "heat pump", clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
        expect(read.pages).toEqual([{ page: "https://example.com/heat", clicks: 1, impressions: 4, ctr: 0.25, position: 2 }]);
      } else {
        for (const key of call.rows) expect(read[key]).toEqual([]);
      }
      const text = JSON.stringify(body);
      expect(text).not.toContain(clientName);
      expect(text).not.toContain("bodyHtml");
      expect(text).not.toContain("person@example.com");
      expect(text).not.toContain(INTERNAL_KEY);
      expect(text).not.toContain("not_synced");
      expect(text).not.toContain("ga4");
    }
  });

  it("returns 403 when Brain says the client is out of scope", async () => {
    brainMode = "deny";
    try {
      const res = await postRead(readBody("get_store_catalog", readIdentityId, clientId));
      const text = await res.text();
      expect(res.status).toBe(403);
      expect(text).toBe(JSON.stringify({ ok: false }));
      expect(text).not.toContain(clientId);
      expect(text).not.toContain(INTERNAL_KEY);
      expect(text).not.toContain("stub");
    } finally {
      brainMode = "ok";
    }
  });

  it("has no stub read left on the façade", () => {
    const source = readFileSync(new URL("../src/mcp-reads.ts", import.meta.url), "utf8");
    expect(source).not.toContain("not_synced");
    expect(source).not.toContain("sourceSystem: \"stub\"");
    expect(source).toContain("fetchBrainMcpRead");
  });
});
