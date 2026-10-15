import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { rejectUntilScopedBearer } from "../src/auth";
import { ALLOWED_ORIGIN, TOKEN, acceptingAuthenticator, readJson, request2025Initialize, request2026, testApp } from "./helpers";

const envKeys = ["MCP_AUTH_DISABLED", "MCP_ALLOW_UNAUTHENTICATED", "AUTH_DISABLED", "MCP_AUTHENTICATOR"];
const previousEnv = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of envKeys) {
    const prior = previousEnv.get(key);
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
});

async function denied(init: RequestInit & { headers?: Record<string, string> }, path = "/mcp") {
  const { app, guard } = testApp();
  const res = await app.request(path, init);
  return { res, body: await readJson(res), guard };
}

describe("default authenticator", () => {
  it("rejects every credential shape", () => {
    for (const header of [null, "", "Bearer", "Bearer ", `Bearer ${TOKEN}`, "bearer token", "Basic dXNlcjpwYXNz", "Token xyz"]) {
      expect(rejectUntilScopedBearer(header)).toEqual({ ok: false });
    }
  });

  it("does not read the environment", () => {
    const source = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env/);
  });

  it("is what the server process wires, with no authenticator override", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/authenticator/);
    expect(source).toMatch(/createHttpGuardClient/);
    const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    expect(appSource).toMatch(/rejectUntilScopedBearer/);
    expect(appSource).not.toMatch(/process\.env/);
  });
});

describe("POST /mcp stays 401 until scoped bearer auth exists", () => {
  const presentations: Array<{ name: string; init: ReturnType<typeof request2026> | { method: string; headers: Record<string, string>; body: string } }> = [
    { name: "no authorization header", init: request2026() },
    { name: "empty authorization", init: request2026({ authorization: "" }) },
    { name: "bearer scheme only", init: request2026({ authorization: "Bearer" }) },
    { name: "bearer with token", init: request2026({ authorization: `Bearer ${TOKEN}` }) },
    { name: "lowercase bearer", init: request2026({ authorization: `bearer ${TOKEN}` }) },
    { name: "basic auth", init: request2026({ authorization: "Basic dXNlcjpwYXNz" }) },
    { name: "token scheme", init: request2026({ authorization: `Token ${TOKEN}` }) },
    {
      name: "service key header",
      init: request2026({ extraHeaders: { "x-cerevex-internal-key": TOKEN } }),
    },
    {
      name: "api key header",
      init: request2026({ extraHeaders: { "x-api-key": TOKEN } }),
    },
    {
      name: "session cookie",
      init: request2026({ extraHeaders: { cookie: `tharros_session=${TOKEN}` } }),
    },
  ];

  for (const presentation of presentations) {
    it(`returns 401 for ${presentation.name}`, async () => {
      const { res, body } = await denied(presentation.init);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect(JSON.stringify([...res.headers.entries()])).not.toContain(TOKEN);
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Authentication required" },
      });
    });
  }

  it("returns the same 401 body whether or not a bearer token is present", async () => {
    const bare = await denied(request2026());
    const bearer = await denied(request2026({ authorization: `Bearer ${TOKEN}` }));
    expect(bare.res.status).toBe(bearer.res.status);
    expect(bare.body).toEqual(bearer.body);
    expect(bare.res.headers.get("www-authenticate")).toBe(bearer.res.headers.get("www-authenticate"));
  });

  it("does not accept the token from the query string or the JSON body", async () => {
    const query = await denied({
      ...request2026(),
      method: "POST",
    });
    const { app } = testApp();
    const fromQuery = await app.request(`/mcp?access_token=${TOKEN}&token=${TOKEN}`, request2026());
    const fromBody = await app.request(
      "/mcp",
      request2026({
        arguments: { access_token: TOKEN, note: "do-not-log-this-phrase" },
        method: "tools/call",
        name: "ping",
        authorization: undefined,
      }),
    );
    expect(query.res.status).toBe(401);
    expect(fromQuery.status).toBe(401);
    const queryText = await fromQuery.text();
    expect(queryText).not.toContain(TOKEN);
    expect(fromQuery.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(fromBody.status).toBe(401);
    const bodyText = await fromBody.text();
    expect(bodyText).not.toContain(TOKEN);
    expect(bodyText).not.toContain("do-not-log-this-phrase");
    expect(bodyText).not.toContain("pong");
  });

  it("keeps a long bearer token out of the response", async () => {
    const longToken = `k${"a".repeat(4000)}`;
    const { res, body } = await denied(request2026({ authorization: `Bearer ${longToken}` }));
    expect(res.status).toBe(401);
    expect(JSON.stringify(body)).not.toContain(longToken);
    expect(res.headers.get("www-authenticate")).not.toContain(longToken);
  });

  it("does not open a session for a 2025-11-25 initialize", async () => {
    const { app, guard } = testApp();
    const first = await app.request("/mcp", request2025Initialize());
    const second = await app.request("/mcp", request2025Initialize());
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(first.headers.get("mcp-session-id")).toBeNull();
    expect(second.headers.get("mcp-session-id")).toBeNull();
    const body = await readJson(first);
    expect(body).toMatchObject({ id: 7, error: { message: "Authentication required" } });
    expect(guard.calls.audits.every((entry) => entry.authType === "unauthenticated" && entry.identityId === null)).toBe(true);
  });

  it("does not run ping, and a thrown authenticator is still 401", async () => {
    const closed = await denied(request2026({ method: "tools/call", name: "ping", arguments: { apply: true } }));
    expect(closed.res.status).toBe(401);
    expect(JSON.stringify(closed.body)).not.toContain("pong");

    const { app } = testApp({
      authenticator: () => {
        throw new Error(`verifier blew up ${TOKEN}`);
      },
    });
    const res = await app.request("/mcp", request2026({ authorization: `Bearer ${TOKEN}` }));
    const text = await res.text();
    expect(res.status).toBe(401);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("verifier blew up");
    expect(text).not.toContain("stack");
  });

  it("ignores env flags that would skip auth", async () => {
    for (const key of envKeys) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "1";
    }
    const { res } = await denied(request2026({ authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(401);
  });

  it("logs the denial without the token, the phrase, or an identity", async () => {
    const { guard } = await denied(
      request2026({
        authorization: `Bearer ${TOKEN}`,
        method: "tools/call",
        name: "ping",
        arguments: { secret: "do-not-log-this-phrase" },
      }),
    );
    expect(guard.calls.audits).toHaveLength(1);
    const entry = guard.calls.audits[0];
    expect(entry).toMatchObject({
      result: "denied",
      httpStatus: 401,
      reason: "unauthenticated",
      protocolVersion: "2026-07-28",
      method: "tools/call",
      tool: "ping",
      clientName: "ExampleClient",
      clientVersion: "1.0.0",
      identityId: null,
      identityName: null,
      authType: "unauthenticated",
    });
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
    expect(JSON.stringify(entry)).not.toContain("do-not-log-this-phrase");
    expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("still returns 401 when the audit write fails", async () => {
    const { app } = testApp({
      audit: () => {
        throw new Error(`audit down ${TOKEN}`);
      },
    });
    const res = await app.request("/mcp", request2026({ authorization: `Bearer ${TOKEN}` }));
    const text = await res.text();
    expect(res.status).toBe(401);
    expect(text).toContain("Authentication required");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("audit down");
  });

  it("leaves /health open and does not treat nearby paths as /mcp", async () => {
    const { app, guard } = testApp();
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "cerevex-mcp" });
    expect(guard.calls.kill).toBe(0);
    expect(guard.calls.audits).toHaveLength(0);

    const posted = await app.request("/health", { method: "POST" });
    expect(posted.status).toBe(404);
    const extra = await app.request("/mcp/ping", request2026());
    expect(extra.status).toBe(404);
    const upper = await app.request("/MCP", request2026());
    expect(upper.status).toBe(404);
  });

  it("reaches ping only when a replacement authenticator accepts the caller", async () => {
    const { app, guard } = testApp({ authenticator: acceptingAuthenticator });
    const listed = await app.request("/mcp", request2026({ method: "tools/list" }));
    expect(listed.status).toBe(200);
    const listBody = await readJson(listed);
    const tools = (listBody.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["ping"]);
    expect(tools[0]?.annotations.readOnlyHint).toBe(true);

    const pong = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "ping", arguments: { secret: "do-not-log-this-phrase" } }),
    );
    expect(pong.status).toBe(200);
    const pongBody = await readJson(pong);
    expect(JSON.stringify(pongBody)).toContain("pong");
    expect(JSON.stringify(pongBody)).not.toContain("do-not-log-this-phrase");
    expect(guard.calls.audits.at(-1)).toMatchObject({
      result: "ok",
      httpStatus: 200,
      tool: "ping",
      authType: "agent",
      identityName: "ping-agent",
    });

    const other = await app.request("/mcp", request2026({ method: "tools/call", name: "submit_recommendation" }));
    expect(other.status).toBe(400);
    expect(await other.text()).not.toContain("pong");
  });

  it("does not return a tool result when the success audit fails", async () => {
    const { app } = testApp({
      authenticator: acceptingAuthenticator,
      audit: () => {
        throw new Error("audit down");
      },
    });
    const res = await app.request("/mcp", request2026({ method: "tools/call", name: "ping" }));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("Audit log unavailable");
    expect(text).not.toContain("pong");
  });

  it("uses the caller's json-rpc id and a server request id", async () => {
    const { app } = testApp();
    const res = await app.request("/mcp", request2026({ id: "call-42", extraHeaders: { "x-request-id": "injected\r\n" } }));
    const body = await readJson(res);
    expect(body.id).toBe("call-42");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.headers.get("x-request-id")).not.toContain("injected");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("origin gate still applies before auth", () => {
  it("does not turn a rejected origin into 401", async () => {
    const { app } = testApp();
    const res = await app.request("/mcp", request2026({ origin: "https://evil.example", authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(await res.text()).not.toContain(ALLOWED_ORIGIN);
  });
});
