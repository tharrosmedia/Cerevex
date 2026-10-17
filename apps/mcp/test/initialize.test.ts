import { describe, expect, it } from "vitest";
import { createBearerAuthenticator } from "../src/auth";
import { hashMcpToken } from "../src/token";
import {
  DEFAULT_PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
  PREFERRED_PROTOCOL_VERSION,
  PROTOCOL_2025,
  PROTOCOL_2025_03,
  PROTOCOL_2025_06,
  PROTOCOL_2026,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../src/protocol";
import { SERVICE_NAME } from "../src/app";
import { ALLOWED_ORIGIN, readJson, request2026, testApp } from "./helpers";

const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";

function tokenFor(label: string) {
  return `cxm_${label}${"a".repeat(43 - label.length)}`;
}

const readToken = tokenFor("read");
const submitToken = tokenFor("subm");

function verifier() {
  const calls: string[] = [];
  const rows = new Map<string, Array<"cerevex.read" | "cerevex.recs.submit">>([
    [hashMcpToken(readToken), ["cerevex.read"]],
    [hashMcpToken(submitToken), ["cerevex.recs.submit"]],
  ]);
  const authenticator = createBearerAuthenticator(async (hash) => {
    calls.push(hash);
    const scopes = rows.get(hash);
    if (!scopes) return null;
    return { id: IDENTITY_ID, name: "example-agent", scopes };
  });
  return { authenticator, calls };
}

function post(input: {
  method: string;
  id?: number | null;
  protocolVersion?: string | null;
  authorization?: string;
  params?: Record<string, unknown>;
  accept?: boolean;
}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ALLOWED_ORIGIN,
  };
  if (input.accept) headers.accept = "application/json, text/event-stream";
  if (input.protocolVersion) headers["mcp-protocol-version"] = input.protocolVersion;
  if (input.authorization) headers.authorization = input.authorization;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method: input.method };
  if (input.id !== null) body.id = input.id ?? 1;
  if (input.params) body.params = input.params;
  return { method: "POST" as const, headers, body: JSON.stringify(body) };
}

function initializeParams(protocolVersion: string) {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "mcp-remote", version: "0.1.37" },
  };
}

describe("initialize handshake", () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    it(`returns ${version} when the client requests it`, async () => {
      const { authenticator } = verifier();
      const { app, guard } = testApp({ authenticator });
      const res = await app.request(
        "/mcp",
        post({
          method: "initialize",
          id: 4,
          protocolVersion: version,
          authorization: `Bearer ${readToken}`,
          params: initializeParams(version),
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).toBeNull();
      const body = await readJson(res);
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        id: 4,
        result: {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: SERVICE_NAME, version: MCP_SERVER_VERSION },
        },
      });
      const result = body.result as Record<string, unknown>;
      if (version === PROTOCOL_2026) {
        expect(result._meta).toEqual({ "io.modelcontextprotocol/protocolVersion": PROTOCOL_2026 });
      } else {
        expect(result._meta).toBeUndefined();
      }
      expect(JSON.stringify(body)).not.toContain(readToken);
      expect(guard.calls.audits[0]).toMatchObject({
        result: "ok",
        httpStatus: 200,
        protocolVersion: version,
        method: "initialize",
        clientName: "mcp-remote",
        clientVersion: "0.1.37",
        authType: "agent",
        identityId: IDENTITY_ID,
      });
    });
  }

  it("negotiates an unsupported requested version to the preferred revision", async () => {
    const { authenticator, calls } = verifier();
    const { app } = testApp({ authenticator });
    const res = await app.request(
      "/mcp",
      post({
        method: "initialize",
        authorization: `Bearer ${readToken}`,
        params: initializeParams("2024-11-05"),
      }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      result: {
        protocolVersion: PREFERRED_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVICE_NAME, version: MCP_SERVER_VERSION },
        _meta: { "io.modelcontextprotocol/protocolVersion": PREFERRED_PROTOCOL_VERSION },
      },
    });
    expect(calls).toHaveLength(1);

    const { app: closed } = testApp();
    const denied = await closed.request("/mcp", post({ method: "initialize", params: initializeParams("1999-01-01") }));
    expect(denied.status).toBe(401);
    expect(await readJson(denied)).toMatchObject({ error: { message: "Authentication required" } });
  });

  it("negotiates from the body when the initialize header names another supported revision", async () => {
    const { authenticator } = verifier();
    const { app } = testApp({ authenticator });
    const res = await app.request(
      "/mcp",
      post({
        method: "initialize",
        protocolVersion: PROTOCOL_2025,
        authorization: `Bearer ${readToken}`,
        params: initializeParams(PROTOCOL_2025_03),
      }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ result: { protocolVersion: PROTOCOL_2025_03 } });
  });

  it("does not require MCP-Protocol-Version on initialize", async () => {
    const { authenticator } = verifier();
    const { app } = testApp({ authenticator });
    const res = await app.request(
      "/mcp",
      post({
        method: "initialize",
        authorization: `Bearer ${readToken}`,
        params: initializeParams(PROTOCOL_2025_06),
      }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      result: { protocolVersion: PROTOCOL_2025_06, capabilities: { tools: {} } },
    });
  });

  it("still rejects an explicit unsupported protocol header on initialize", async () => {
    const { authenticator, calls } = verifier();
    const { app } = testApp({ authenticator });
    const res = await app.request(
      "/mcp",
      post({
        method: "initialize",
        protocolVersion: "2024-11-05",
        authorization: `Bearer ${readToken}`,
        params: initializeParams("2024-11-05"),
      }),
    );
    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({
      error: { code: -32022, message: "Unsupported protocol version" },
    });
    expect(calls).toHaveLength(0);
  });

  it("accepts a 2026 initialize that carries the mirrored headers", async () => {
    const { authenticator } = verifier();
    const { app, guard } = testApp({ authenticator });
    const res = await app.request("/mcp", request2026({ method: "initialize", authorization: `Bearer ${readToken}` }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      result: { protocolVersion: PROTOCOL_2026, serverInfo: { name: SERVICE_NAME } },
    });
    expect(guard.calls.audits[0]).toMatchObject({ clientName: "ExampleClient", method: "initialize" });
  });

  it("defaults a later request with no protocol header to 2025-03-26", async () => {
    const { authenticator } = verifier();
    const { app, guard } = testApp({ authenticator });
    const res = await app.request(
      "/mcp",
      post({ method: "tools/list", authorization: `Bearer ${readToken}` }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.result).not.toHaveProperty("_meta");
    expect((body.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("ping");
    expect(guard.calls.audits[0]).toMatchObject({
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      method: "tools/list",
      result: "ok",
    });
  });

  it("keeps the bearer check in front of tools/list and tools/call", async () => {
    const { authenticator } = verifier();
    const { app } = testApp({ authenticator });
    for (const version of [PROTOCOL_2025_03, PROTOCOL_2025_06, PROTOCOL_2025, PROTOCOL_2026]) {
      const list = await app.request(
        "/mcp",
        version === PROTOCOL_2026
          ? request2026({ method: "tools/list" })
          : post({ method: "tools/list", protocolVersion: version }),
      );
      expect(list.status, version).toBe(401);
      expect(list.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      const call = await app.request(
        "/mcp",
        version === PROTOCOL_2026
          ? request2026({ method: "tools/call", name: "ping" })
          : post({
              method: "tools/call",
              protocolVersion: version,
              params: { name: "ping", arguments: {} },
            }),
      );
      expect(call.status, version).toBe(401);
      expect(await call.text()).not.toContain("pong");
    }

    const submitList = await app.request(
      "/mcp",
      post({ method: "tools/list", protocolVersion: PROTOCOL_2025_03, authorization: `Bearer ${submitToken}` }),
    );
    expect(submitList.status).toBe(403);
    expect(submitList.headers.get("www-authenticate")).toContain("cerevex.read");

    const submitPing = await app.request(
      "/mcp",
      post({
        method: "tools/call",
        protocolVersion: PROTOCOL_2025_03,
        authorization: `Bearer ${submitToken}`,
        params: { name: "ping", arguments: {} },
      }),
    );
    expect(submitPing.status).toBe(403);
    expect(await submitPing.text()).not.toContain("pong");
  });

  it("does not let initialize skip auth, the kill switch, or the identity cap", async () => {
    const { app: closed } = testApp();
    const anonymous = await closed.request(
      "/mcp",
      post({ method: "initialize", params: initializeParams(PROTOCOL_2025_03) }),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("mcp-session-id")).toBeNull();
    expect(await readJson(anonymous)).toMatchObject({ error: { message: "Authentication required" } });

    const { authenticator, calls } = verifier();
    const { app: killed, guard } = testApp({ authenticator, killSwitchEnv: "on" });
    const blocked = await killed.request(
      "/mcp",
      post({
        method: "initialize",
        authorization: `Bearer ${readToken}`,
        params: initializeParams(PROTOCOL_2025_03),
      }),
    );
    expect(blocked.status).toBe(403);
    const blockedText = await blocked.text();
    expect(JSON.parse(blockedText)).toMatchObject({ error: { message: "Connector is off" } });
    expect(blockedText).not.toContain("serverInfo");
    expect(calls).toHaveLength(0);
    expect(guard.calls.kill).toBe(0);

    const { authenticator: cappedAuth } = verifier();
    const { app: capped } = testApp({ authenticator: cappedAuth, identityCallsPerMinute: 1 });
    const first = await capped.request(
      "/mcp",
      post({
        method: "initialize",
        protocolVersion: PROTOCOL_2025_03,
        authorization: `Bearer ${readToken}`,
        params: initializeParams(PROTOCOL_2025_03),
      }),
    );
    expect(first.status).toBe(200);
    const second = await capped.request(
      "/mcp",
      post({ method: "tools/list", protocolVersion: PROTOCOL_2025_03, authorization: `Bearer ${readToken}` }),
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("walks an mcp-remote session from initialize through tools/call", async () => {
    const { authenticator, calls } = verifier();
    const { app, guard } = testApp({ authenticator });
    const bearer = `Bearer ${readToken}`;

    const opened = await app.request(
      "/mcp",
      post({
        method: "initialize",
        id: 1,
        accept: true,
        authorization: bearer,
        params: initializeParams(PROTOCOL_2025_03),
      }),
    );
    expect(opened.status).toBe(200);
    expect(opened.headers.get("mcp-session-id")).toBeNull();
    const handshake = await readJson(opened);
    expect(handshake).toMatchObject({
      id: 1,
      result: {
        protocolVersion: PROTOCOL_2025_03,
        capabilities: { tools: {} },
        serverInfo: { name: SERVICE_NAME, version: MCP_SERVER_VERSION },
      },
    });
    const negotiated = (handshake.result as { protocolVersion: string }).protocolVersion;

    const ready = await app.request(
      "/mcp",
      post({
        method: "notifications/initialized",
        id: null,
        accept: true,
        protocolVersion: negotiated,
        authorization: bearer,
      }),
    );
    expect(ready.status).toBe(202);
    expect(await ready.text()).toBe("");
    expect(ready.headers.get("mcp-session-id")).toBeNull();

    const listed = await app.request(
      "/mcp",
      post({
        method: "tools/list",
        id: 2,
        accept: true,
        protocolVersion: negotiated,
        authorization: bearer,
      }),
    );
    expect(listed.status).toBe(200);
    const tools = ((await readJson(listed)).result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(tools).toEqual([
      "ping",
      "get_gsc_performance",
      "get_seo_findings",
      "get_store_catalog",
      "submit_recommendation",
    ]);

    const pong = await app.request(
      "/mcp",
      post({
        method: "tools/call",
        id: 3,
        accept: true,
        protocolVersion: negotiated,
        authorization: bearer,
        params: { name: "ping", arguments: {} },
      }),
    );
    expect(pong.status).toBe(200);
    const pongBody = await readJson(pong);
    expect(JSON.stringify(pongBody)).toContain("pong");
    expect(JSON.stringify(pongBody)).not.toContain(readToken);
    expect(pong.headers.get("mcp-session-id")).toBeNull();

    const bareList = await app.request("/mcp", post({ method: "tools/list", protocolVersion: negotiated }));
    const bareCall = await app.request(
      "/mcp",
      post({
        method: "tools/call",
        protocolVersion: negotiated,
        params: { name: "ping", arguments: {} },
      }),
    );
    expect(bareList.status).toBe(401);
    expect(bareCall.status).toBe(401);
    expect(await bareCall.text()).not.toContain("pong");

    const bareNotice = await app.request(
      "/mcp",
      post({ method: "notifications/initialized", id: null, protocolVersion: negotiated }),
    );
    expect(bareNotice.status).toBe(401);

    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(guard.calls.audits.map((entry) => entry.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "tools/list",
      "tools/call",
      "notifications/initialized",
    ]);
    expect(guard.calls.audits[1]).toMatchObject({
      result: "ok",
      httpStatus: 202,
      method: "notifications/initialized",
      authType: "agent",
    });
    expect(JSON.stringify(guard.calls.audits)).not.toContain(readToken);
  });

  it("does not accept notifications/initialized when the audit write fails", async () => {
    const { authenticator } = verifier();
    const { app } = testApp({
      authenticator,
      audit: () => {
        throw new Error("audit down");
      },
    });
    const res = await app.request(
      "/mcp",
      post({
        method: "notifications/initialized",
        id: null,
        protocolVersion: PROTOCOL_2025_03,
        authorization: `Bearer ${readToken}`,
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("Audit log unavailable");
    expect(text).not.toContain(readToken);
  });
});
