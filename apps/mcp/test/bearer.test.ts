import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KILL_SWITCH_CACHE_MS } from "../src/app";
import { createBearerAuthenticator } from "../src/auth";
import { buildSecurityAuditEntry } from "../src/audit";
import { MAX_MCP_BODY_BYTES, readLimitedText } from "../src/body";
import { createHttpGuardClient } from "../src/guards";
import { hashMcpToken } from "../src/token";
import { ALLOWED_ORIGIN, TOKEN, readJson, request2026, testApp } from "./helpers";

const HASH = "5891371737a653c4800cad5dfa0846e827562ed4fa4c22ae0c9ffbd509f01be5";
const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";

function tokenFor(label: string) {
  const token = `cxm_${label}${"a".repeat(43 - label.length)}`;
  return token;
}

describe("token hash", () => {
  it("is sha256 of the exact token, including the prefix", () => {
    expect(hashMcpToken("cxm_example")).toBe(HASH);
    expect(hashMcpToken("cxm_example")).toBe(createHash("sha256").update("cxm_example", "utf8").digest("hex"));
    expect(hashMcpToken("cxm_example")).not.toBe(createHash("sha256").update("example", "utf8").digest("hex"));
  });
});

describe("scoped bearer", () => {
  const readToken = tokenFor("read");
  const submitToken = tokenFor("subm");
  const bothToken = tokenFor("both");

  function verifier(revoked = new Set<string>()) {
    const calls: string[] = [];
    const rows = new Map<string, { scopes: Array<"cerevex.read" | "cerevex.recs.submit"> }>([
      [hashMcpToken(readToken), { scopes: ["cerevex.read"] }],
      [hashMcpToken(submitToken), { scopes: ["cerevex.recs.submit"] }],
      [hashMcpToken(bothToken), { scopes: ["cerevex.read", "cerevex.recs.submit"] }],
    ]);
    const authenticator = createBearerAuthenticator(async (hash) => {
      calls.push(hash);
      if (revoked.has(hash) || !rows.has(hash)) return null;
      return { id: IDENTITY_ID, name: "example-agent", scopes: rows.get(hash)!.scopes };
    });
    return { authenticator, calls, revoked };
  }

  it("accepts a read token for ping and refuses it for submit", async () => {
    const { authenticator, calls } = verifier();
    const { app, guard } = testApp({ authenticator });
    const ping = await app.request("/mcp", request2026({ method: "tools/call", name: "ping", authorization: `Bearer ${readToken}` }));
    expect(ping.status).toBe(200);
    expect(await ping.text()).toContain("pong");
    const submit = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "submit_recommendation", authorization: `Bearer ${readToken}` }),
    );
    expect(submit.status).toBe(403);
    expect(submit.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope", scope="cerevex.recs.submit"');
    expect(await readJson(submit)).toMatchObject({ error: { message: "insufficient_scope" } });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(guard.calls.audits)).not.toContain(readToken);
    expect(guard.calls.audits.at(-1)).toMatchObject({ reason: "insufficient_scope", httpStatus: 403, authType: "agent" });
  });

  it("returns 403 insufficient_scope for tools/list without cerevex.read", async () => {
    const { authenticator } = verifier();
    const { app } = testApp({ authenticator });
    const listed = await app.request("/mcp", request2026({ method: "tools/list", authorization: `Bearer ${submitToken}` }));
    expect(listed.status).toBe(403);
    expect(listed.headers.get("www-authenticate")).toContain("cerevex.read");
    expect(await listed.text()).not.toContain("pong");
  });

  it("checks submit scope before the unknown-tool response", async () => {
    const { authenticator } = verifier();
    const { app } = testApp({ authenticator });
    const allowed = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "validate_recommendation",
        authorization: `Bearer ${bothToken}`,
      }),
    );
    expect(allowed.status).toBe(400);
    expect(await readJson(allowed)).toMatchObject({ error: { message: "Unknown tool" } });
    const missing = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "validate_recommendation", authorization: `Bearer ${readToken}` }),
    );
    expect(missing.status).toBe(403);
  });

  it("returns the same 401 for a missing, malformed, revoked, or unknown token", async () => {
    const { authenticator, revoked } = verifier();
    revoked.add(hashMcpToken(readToken));
    const { app } = testApp({ authenticator });
    const cases = [
      request2026(),
      request2026({ authorization: "" }),
      request2026({ authorization: "Bearer" }),
      request2026({ authorization: `Bearer ${TOKEN}` }),
      request2026({ authorization: `bearer ${readToken}` }),
      request2026({ authorization: `Bearer ${readToken}` }),
      request2026({ authorization: "Basic dXNlcjpwYXNz" }),
      request2026({ extraHeaders: { "x-cerevex-mcp-key": readToken } }),
    ];
    for (const init of cases) {
      const res = await app.request("/mcp", init);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      expect(await res.text()).not.toContain(readToken);
    }
  });

  it("does not cache a verification, so revoke is visible on the next call", async () => {
    const { authenticator, calls, revoked } = verifier();
    const { app } = testApp({ authenticator });
    expect((await app.request("/mcp", request2026({ authorization: `Bearer ${bothToken}` }))).status).toBe(200);
    revoked.add(hashMcpToken(bothToken));
    expect((await app.request("/mcp", request2026({ authorization: `Bearer ${bothToken}` }))).status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it("treats an empty identity from the verifier as unauthenticated", async () => {
    const { app } = testApp({
      authenticator: () => ({ ok: true, identity: { id: "", name: "", scopes: [] } }),
    });
    const res = await app.request("/mcp", request2026({ authorization: `Bearer ${bothToken}` }));
    expect(res.status).toBe(401);
  });

  it("sends only the hash to the ads API", async () => {
    const seen: string[] = [];
    const guards = createHttpGuardClient({
      apiUrl: "http://127.0.0.1:43180",
      mcpKey: "mcp-key",
      fetchImpl: async (_url, init) => {
        seen.push(String(init?.body ?? ""));
        const headers = new Headers(init?.headers);
        expect(headers.get("x-cerevex-mcp-key")).toBe("mcp-key");
        expect(headers.get("x-cerevex-internal-key")).toBeNull();
        return new Response(
          JSON.stringify({
            ok: true,
            identity: { id: IDENTITY_ID, name: "example-agent", scopes: ["cerevex.read"] },
          }),
          { status: 200 },
        );
      },
    });
    const authenticator = createBearerAuthenticator((hash) => guards.verifyToken(hash));
    const decision = await authenticator(`Bearer ${readToken}`);
    expect(decision.ok).toBe(true);
    expect(seen).toEqual([JSON.stringify({ tokenHash: hashMcpToken(readToken) })]);
    expect(seen[0]).not.toContain(readToken);
  });
});

describe("denied-request holds", () => {
  it("stops an unauthenticated flood per IP and aggregates the audit", async () => {
    const auditControl = { flush: async () => {} };
    let clock = 1_000_000;
    const { app, guard } = testApp({
      deniedPerIp: 2,
      deniedFlushMs: 60_000,
      auditControl,
      now: () => clock,
      killSwitchTtlMs: KILL_SWITCH_CACHE_MS,
    });
    const headers = { "x-forwarded-for": "203.0.113.8" };
    const first = await app.request("/mcp", request2026({ extraHeaders: headers }));
    const second = await app.request("/mcp", request2026({ extraHeaders: headers }));
    const third = await app.request("/mcp", request2026({ extraHeaders: headers }));
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(guard.calls.kill).toBe(1);
    expect(guard.calls.audits).toHaveLength(0);
    await auditControl.flush();
    expect(guard.calls.audits).toHaveLength(2);
    expect(guard.calls.audits.find((entry) => entry.reason === "unauthenticated")).toMatchObject({
      httpStatus: 401,
      count: 2,
    });
    expect(guard.calls.audits.find((entry) => entry.reason === "rate_limited")).toMatchObject({
      httpStatus: 429,
      count: 1,
    });
    const other = await app.request("/mcp", request2026({ extraHeaders: { "x-forwarded-for": "203.0.113.9" } }));
    expect(other.status).toBe(401);
    clock += KILL_SWITCH_CACHE_MS;
    await app.request("/mcp", request2026({ extraHeaders: { "x-forwarded-for": "203.0.113.9" } }));
    expect(guard.calls.kill).toBe(2);
  });

  it("does not count a successful call toward the denied limiter", async () => {
    const { app } = testApp({
      deniedPerIp: 1,
      authenticator: () => ({
        ok: true,
        identity: { id: IDENTITY_ID, name: "example-agent", scopes: ["cerevex.read"] },
      }),
    });
    const ok = await app.request("/mcp", request2026({ extraHeaders: { "x-forwarded-for": "198.51.100.4" } }));
    expect(ok.status).toBe(200);
    const again = await app.request("/mcp", request2026({ extraHeaders: { "x-forwarded-for": "198.51.100.4" } }));
    expect(again.status).toBe(200);
  });
});

describe("64KB body cap", () => {
  it("pins the cap at 65536 bytes", async () => {
    expect(MAX_MCP_BODY_BYTES).toBe(65_536);
    const body = (bytes: number, declared: string | null) => {
      const headers = new Map<string, string>();
      if (declared !== null) headers.set("content-length", declared);
      const chunk = new Uint8Array(bytes);
      return {
        headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk);
            controller.close();
          },
        }),
      } as Request;
    };
    expect((await readLimitedText(body(65_536, "65536"), MAX_MCP_BODY_BYTES)).ok).toBe(true);
    expect((await readLimitedText(body(1, "65537"), MAX_MCP_BODY_BYTES)).ok).toBe(false);
    expect((await readLimitedText(body(65_537, null), MAX_MCP_BODY_BYTES)).ok).toBe(false);
  });

  it("accepts 65536 bytes and rejects 65537", async () => {
    const { app } = testApp();
    const under = sizedJson(65_536);
    const over = sizedJson(65_537);
    expect(Buffer.byteLength(under)).toBe(65_536);
    expect(Buffer.byteLength(over)).toBe(65_537);
    const allowed = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
      },
      body: under,
    });
    expect(allowed.status).toBe(401);
    const rejected = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
        "content-length": "65537",
      },
      body: over,
    });
    expect(rejected.status).toBe(400);
    const declared = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
        "content-length": "65537",
      },
      body: under,
    });
    expect(declared.status).toBe(400);
  });

  it("rejects a stream that passes 65536 bytes without a content-length", async () => {
    const chunk = new Uint8Array(65_537);
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await readLimitedText(request, MAX_MCP_BODY_BYTES)).toEqual({ ok: false });
    const exact = new Uint8Array(65_536);
    const allowed = new Request("http://localhost/mcp", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(exact);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    const read = await readLimitedText(allowed, MAX_MCP_BODY_BYTES);
    expect(read.ok).toBe(true);
  });
});

describe("audit tool filter", () => {
  const base = {
    requestId: "11111111-1111-4111-8111-111111111111",
    result: "denied" as const,
    httpStatus: 401,
    protocolVersion: "2026-07-28",
    method: "tools/call",
    clientName: "ExampleClient",
    clientVersion: "1.0.0",
    latencyMs: 1,
    reason: "unauthenticated" as const,
    identity: null,
  };

  it("drops a tool name that is not an id", () => {
    expect(buildSecurityAuditEntry({ ...base, tool: "ping" }).tool).toBe("ping");
    expect(buildSecurityAuditEntry({ ...base, tool: "submit_recommendation" }).tool).toBe("submit_recommendation");
    for (const tool of ["bad name", "a".repeat(81), "../secret", "ping;drop", "has space", ""]) {
      expect(buildSecurityAuditEntry({ ...base, tool }).tool).toBeNull();
    }
  });

  it("does not store a 2025 tool name that fails the filter", async () => {
    const { app, guard } = testApp();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "bad name", clientInfo: { name: "ExampleClient", version: "1.0.0" } },
      }),
    });
    expect(res.status).toBe(401);
    expect(guard.calls.audits[0]?.tool).toBeNull();
    expect(JSON.stringify(guard.calls.audits[0])).not.toContain("bad name");
  });
});

function sizedJson(bytes: number): string {
  const prefix =
    '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"ExampleClient","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}},"pad":"';
  const suffix = '"}}';
  return prefix + "a".repeat(bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)) + suffix;
}
