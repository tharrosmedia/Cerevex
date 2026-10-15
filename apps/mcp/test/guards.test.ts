import { describe, expect, it } from "vitest";
import type { SecurityAuditEntry } from "../src/audit";
import { createHttpGuardClient, guardEndpoint } from "../src/guards";

const entry: SecurityAuditEntry = {
  requestId: "11111111-1111-4111-8111-111111111111",
  result: "denied",
  httpStatus: 401,
  protocolVersion: "2026-07-28",
  method: "tools/list",
  tool: null,
  clientName: "ExampleClient",
  clientVersion: "1.0.0",
  latencyMs: 3,
  reason: "unauthenticated",
  identityId: null,
  identityName: null,
  authType: "unauthenticated",
};

const KEY = "test-internal-key-value";

function response(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("ads API guard client", () => {
  it("rejects base URLs that could hide or move the service key", () => {
    expect(guardEndpoint("http://127.0.0.1:43180", "/internal/mcp/connector")).toBe(
      "http://127.0.0.1:43180/internal/mcp/connector",
    );
    expect(guardEndpoint("http://127.0.0.1:43180/", "/internal/mcp/connector")).toBe(
      "http://127.0.0.1:43180/internal/mcp/connector",
    );
    expect(guardEndpoint("http://user:pass@127.0.0.1:43180", "/internal/mcp/connector")).toBeNull();
    expect(guardEndpoint(`http://127.0.0.1:43180?x-cerevex-internal-key=${KEY}`, "/internal/mcp/connector")).toBeNull();
    expect(guardEndpoint("https://ads.example/secret-path", "/internal/mcp/connector")).toBeNull();
    expect(guardEndpoint("file:///tmp/ads", "/internal/mcp/connector")).toBeNull();
  });

  it("does not call the network without a usable URL and key", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return response(200, { killSwitch: false });
    };
    for (const client of [
      createHttpGuardClient({ apiUrl: undefined, internalKey: KEY, fetchImpl }),
      createHttpGuardClient({ apiUrl: "http://127.0.0.1:43180", internalKey: undefined, fetchImpl }),
      createHttpGuardClient({ apiUrl: "http://127.0.0.1:43180", internalKey: ` ${KEY}`, fetchImpl }),
      createHttpGuardClient({ apiUrl: "http://user:pass@127.0.0.1", internalKey: KEY, fetchImpl }),
    ]) {
      expect(await client.readKillSwitch()).toBe("unreachable");
    }
    expect(called).toBe(0);
  });

  it("sends the service key as a header and fails closed on anything but a boolean", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return response(200, { killSwitch: false, applyKillSwitch: true });
    };
    const client = createHttpGuardClient({ apiUrl: "http://127.0.0.1:43180", internalKey: KEY, fetchImpl });
    expect(await client.readKillSwitch()).toBe("clear");
    expect(seen[0]?.url).toBe("http://127.0.0.1:43180/internal/mcp/connector");
    expect(seen[0]?.url).not.toContain(KEY);
    const headers = new Headers(seen[0]?.init.headers);
    expect(headers.get("x-cerevex-internal-key")).toBe(KEY);
    expect(seen[0]?.init.redirect).toBe("manual");

    const badBodies = [{ killSwitch: "false" }, { applyKillSwitch: false }, {}, null];
    for (const body of badBodies) {
      const next = createHttpGuardClient({
        apiUrl: "http://127.0.0.1:43180",
        internalKey: KEY,
        fetchImpl: async () => response(200, body),
      });
      expect(await next.readKillSwitch()).toBe("unreachable");
    }
  });

  it("does not follow a redirect and does not surface an error body", async () => {
    let calls = 0;
    const redirecting = createHttpGuardClient({
      apiUrl: "https://ads.example",
      internalKey: KEY,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
      },
    });
    expect(await redirecting.readKillSwitch()).toBe("unreachable");
    expect(calls).toBe(1);

    const failing = createHttpGuardClient({
      apiUrl: "https://ads.example",
      internalKey: KEY,
      fetchImpl: async () => response(500, `super-secret-from-api ${KEY}`),
    });
    await expect(failing.writeSecurityAudit(entry)).rejects.toThrow("mcp guard request failed");
    await expect(failing.writeSecurityAudit(entry)).rejects.toThrow(/^mcp guard request failed$/);
  });

  it("posts the audit entry and nothing else", async () => {
    let sent = "";
    let url = "";
    const client = createHttpGuardClient({
      apiUrl: "http://127.0.0.1:43180",
      internalKey: KEY,
      fetchImpl: async (input, init) => {
        url = String(input);
        sent = String(init?.body ?? "");
        return response(200, { ok: true });
      },
    });
    await client.writeSecurityAudit(entry);
    expect(url).toBe("http://127.0.0.1:43180/internal/mcp/security-audit");
    expect(url).not.toContain(KEY);
    expect(JSON.parse(sent)).toEqual(entry);
  });
});
