import { describe, expect, it } from "vitest";
import { MCP_READ_MAX_LIMIT } from "@cerevex/contracts";
import type { McpAuthenticator } from "../src/auth";
import type { SecurityAuditEntry } from "../src/audit";
import { createHttpGuardClient, type GuardClient, type McpReadRequest, type McpReadResponse } from "../src/guards";
import { readJson, request2026, testApp } from "./helpers";

const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const NOW = Date.UTC(2026, 9, 16);

function authenticator(scopes: Array<"cerevex.read" | "cerevex.recs.submit">): McpAuthenticator {
  return () => ({ ok: true, identity: { id: IDENTITY_ID, name: "example-agent", scopes } });
}

function guardFor(read: (request: McpReadRequest) => Promise<McpReadResponse> | McpReadResponse) {
  const reads: McpReadRequest[] = [];
  const audits: SecurityAuditEntry[] = [];
  const guards: GuardClient = {
    async readKillSwitch() {
      return "clear";
    },
    async writeSecurityAudit(entry) {
      audits.push(entry);
    },
    async verifyToken() {
      return null;
    },
    async readGranted(request) {
      reads.push(request);
      return read(request);
    },
  };
  return { guards, reads, audits };
}

function synced(request: McpReadRequest, extra: Record<string, unknown>): McpReadResponse {
  return {
    ok: true,
    read: {
      clientId: request.clientId,
      storeId: STORE_ID,
      lastSyncedAt: "2026-10-16T12:00:00.000Z",
      sourceSystem: "brain",
      availability: "ready",
      limit: request.limit,
      nextCursor: "next-page",
      token: "platform-token",
      bodyHtml: "<p>secret</p>",
      ...extra,
    },
  };
}

function textOf(body: Record<string, unknown>): Record<string, unknown> {
  const result = body.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("phase-1 read tools", () => {
  it("returns 403 when the token is missing cerevex.read", async () => {
    let reads = 0;
    const { guards } = guardFor(() => {
      reads += 1;
      return { ok: false, status: 404 };
    });
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_scope",
      }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain("cerevex.read");
    expect(await readJson(res)).toMatchObject({ error: { message: "insufficient_scope" } });
    expect(reads).toBe(0);
  });

  it("denies an ungranted client the same way as one that does not exist", async () => {
    const { guards, audits } = guardFor(() => ({ ok: false, status: 404 }));
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const denied = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_seo_findings",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    const missing = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 2,
        name: "get_seo_findings",
        arguments: { clientId: OTHER_CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    const deniedBody = await readJson(denied);
    const missingBody = await readJson(missing);
    expect(deniedBody.error).toEqual({ code: -32000, message: "not found or not allowed" });
    expect(missingBody.error).toEqual(deniedBody.error);
    expect(JSON.stringify(deniedBody)).not.toContain(CLIENT_ID);
    expect(JSON.stringify(audits)).not.toContain(CLIENT_ID);
    expect(audits.at(-1)).toMatchObject({ reason: "not_granted", result: "denied", httpStatus: 404, tool: "get_seo_findings" });
  });

  it("blocks a read when the kill switch is tripped", async () => {
    let reads = 0;
    const { guards } = guardFor(() => {
      reads += 1;
      return { ok: false, status: 404 };
    });
    guards.readKillSwitch = async () => "tripped";
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Connector is off");
    expect(reads).toBe(0);
  });

  it("refuses a limit above the cap and does not call the façade", async () => {
    let reads = 0;
    const { guards } = guardFor(() => {
      reads += 1;
      return { ok: false, status: 404 };
    });
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const over = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, limit: MCP_READ_MAX_LIMIT + 1, apply: true },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(over.status).toBe(400);
    expect(await readJson(over)).toMatchObject({ error: { message: "Invalid arguments" } });
    const wide = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 2,
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, dateStart: "2026-01-01", dateEnd: "2026-01-29" },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(wide.status).toBe(400);
    expect(reads).toBe(0);
    const capped = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 3,
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID, limit: MCP_READ_MAX_LIMIT + 1 },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(capped.status).toBe(400);
    expect(await readJson(capped)).toMatchObject({ error: { message: "Invalid arguments" } });
    expect(reads).toBe(0);
  });

  it("fails closed when the read throws or the façade is unavailable", async () => {
    const thrown = guardFor(() => {
      throw new Error("ads down secret");
    });
    const { app } = testApp({ guards: thrown.guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("Read unavailable");
    expect(text).not.toContain("not_synced");
    expect(text).not.toContain("ads down secret");
    expect(text).not.toContain('"isError":false');
    expect(thrown.audits.at(-1)).toMatchObject({ result: "error", httpStatus: 500, tool: "get_store_catalog" });

    const down = guardFor(() => ({ ok: false, status: 500 }));
    const { app: unavailable } = testApp({ guards: down.guards, authenticator: authenticator(["cerevex.read"]) });
    const again = await unavailable.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    const againText = await again.text();
    expect(again.status).toBe(500);
    expect(againText).toContain("Read unavailable");
    expect(againText).not.toContain("not_synced");
    expect(againText).not.toContain('"isError":false');
  });

  it("refuses a façade body whose client id is not the one requested", async () => {
    const foreignStore = "55555555-5555-4555-8555-555555555555";
    const { guards } = guardFor(() => ({
      ok: true,
      read: {
        clientId: OTHER_CLIENT_ID,
        storeId: foreignStore,
        lastSyncedAt: null,
        sourceSystem: "stub",
        availability: "not_synced",
        limit: 1,
        nextCursor: null,
        queries: [{ query: "other-tenant-query", clicks: 1, impressions: 2, ctr: 0.5, position: 3 }],
        pages: [],
      },
    }));
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, limit: 1 },
        authorization: "Bearer cxm_read",
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("Read unavailable");
    expect(text).not.toContain(OTHER_CLIENT_ID);
    expect(text).not.toContain(foreignStore);
    expect(text).not.toContain("other-tenant-query");
    expect(text).not.toContain("not_synced");
  });

  it("returns a bounded Search Console read for a granted client", async () => {
    const { guards, reads, audits } = guardFor((request) =>
      synced(request, {
        queries: [
          { query: "person@example.com", clicks: 1, impressions: 1, ctr: 1, position: 1 },
          { query: "heat pump", clicks: 3, impressions: 30, ctr: 0.1, position: 4.25 },
          { query: "mini split", clicks: 2, impressions: 10, ctr: 0.2, position: 6 },
        ],
        pages: [{ page: "https://example.com/heat", clicks: 1, impressions: 4, ctr: 0.25, position: 2 }],
      }),
    );
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]), now: () => NOW });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, limit: 1 },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(200);
    const payload = textOf(await readJson(res));
    expect(payload).toMatchObject({
      clientId: CLIENT_ID,
      storeId: STORE_ID,
      lastSyncedAt: "2026-10-16T12:00:00.000Z",
      sourceSystem: "brain",
      availability: "ready",
      limit: 1,
      returned: 1,
      dateStart: "2026-09-19",
      dateEnd: "2026-10-16",
      view: "both",
      queries: [{ query: "heat pump", clicks: 3, impressions: 30, ctr: 0.1, position: 4.25 }],
    });
    expect(payload.pages).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("person@example.com");
    expect(JSON.stringify(payload)).not.toContain("platform-token");
    expect(JSON.stringify(payload)).not.toContain("bodyHtml");
    expect(reads[0]).toMatchObject({ identityId: IDENTITY_ID, clientId: CLIENT_ID, limit: 1, view: "both" });
    expect(JSON.stringify(audits)).not.toContain("heat pump");
    expect(audits.at(-1)).toMatchObject({ result: "ok", reason: "call", tool: "get_gsc_performance", httpStatus: 200 });
  });

  it("returns bounded SEO findings for a granted client", async () => {
    const findingId = "55555555-5555-4555-8555-555555555555";
    const { guards } = guardFor((request) =>
      synced(request, {
        status: "open",
        findings: [
          { id: findingId, kind: "title", severity: "low", title: "Call 555-010-0199", status: "open", handle: "contact" },
          { id: findingId, kind: "title", severity: "high", title: "Short title", status: "open", handle: "services", detail: { email: "person@example.com" } },
        ],
      }),
    );
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_seo_findings",
        arguments: { clientId: CLIENT_ID, limit: 1, status: "open" },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(200);
    const payload = textOf(await readJson(res));
    expect(payload).toMatchObject({
      clientId: CLIENT_ID,
      availability: "ready",
      sourceSystem: "brain",
      status: "open",
      limit: 1,
      returned: 1,
      findings: [{ id: findingId, kind: "title", severity: "high", title: "Short title", status: "open", handle: "services" }],
    });
    expect(JSON.stringify(payload)).not.toContain("person@example.com");
    expect(JSON.stringify(payload)).not.toContain("555-010-0199");
    expect(JSON.stringify(payload)).not.toContain("detail");
  });

  it("returns a bounded catalog summary for a granted client", async () => {
    const { guards } = guardFor((request) =>
      synced(request, {
        products: [
          { handle: "mini-split", title: "Mini split", bodyHtml: "<p>secret</p>" },
          { handle: "thermostat", title: "Thermostat" },
        ],
        collections: [{ handle: "cooling", title: "Cooling" }],
      }),
    );
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID, limit: 1 },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(200);
    const payload = textOf(await readJson(res));
    expect(payload).toMatchObject({
      clientId: CLIENT_ID,
      availability: "ready",
      sourceSystem: "brain",
      limit: 1,
      returned: 1,
      products: [{ handle: "mini-split", title: "Mini split" }],
      collections: [],
    });
    expect(JSON.stringify(payload)).not.toContain("bodyHtml");
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("thermostat");
  });

  it("drops a stub payload instead of returning it", async () => {
    const { guards } = guardFor((request) => ({
      ok: true,
      read: {
        clientId: request.clientId,
        storeId: STORE_ID,
        lastSyncedAt: null,
        sourceSystem: "stub",
        availability: "not_synced",
        limit: request.limit,
        nextCursor: null,
        products: [{ handle: "mini-split", title: "Mini split" }],
        collections: [],
      },
    }));
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("Read unavailable");
    expect(text).not.toContain("not_synced");
    expect(text).not.toContain("mini-split");
    expect(text).not.toContain('"isError":false');
  });

  it("does not register a GA4 tool", async () => {
    const { guards } = guardFor(() => ({ ok: false, status: 404 }));
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_ga4_report",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ error: { message: "Unknown tool" } });
  });

  it("posts the read to the ads façade and keeps not-found bodies identical", async () => {
    const seen: string[] = [];
    const client = createHttpGuardClient({
      apiUrl: "http://127.0.0.1:43180",
      mcpKey: "mcp-key",
      fetchImpl: async (url, init) => {
        seen.push(String(url));
        expect(String(init?.body)).not.toContain("mcp-key");
        expect(new Headers(init?.headers).get("x-cerevex-mcp-key")).toBe("mcp-key");
        const message = seen.length === 1 ? "Client not found" : "no grant";
        return new Response(JSON.stringify({ ok: false, message }), { status: 404 });
      },
    });
    const request: McpReadRequest = {
      tool: "get_store_catalog",
      identityId: IDENTITY_ID,
      clientId: CLIENT_ID,
      limit: 1,
      cursor: null,
    };
    expect(await client.readGranted(request)).toEqual({ ok: false, status: 404 });
    expect(await client.readGranted({ ...request, clientId: OTHER_CLIENT_ID })).toEqual({ ok: false, status: 404 });
    expect(seen).toEqual([
      "http://127.0.0.1:43180/internal/mcp/read",
      "http://127.0.0.1:43180/internal/mcp/read",
    ]);
  });
});
