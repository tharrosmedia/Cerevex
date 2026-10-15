import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeMirroredName } from "../src/protocol";
import { readJson, request2025Initialize, request2026, testApp } from "./helpers";

describe("streamable HTTP checks", () => {
  it("rejects an unsupported protocol version with the supported list", async () => {
    const { app } = testApp();
    const res = await app.request("/mcp", request2026({ protocolHeader: "2025-03-26" }));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({
      id: 1,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: ["2026-07-28", "2025-11-25"], requested: "2025-03-26" },
      },
    });
  });

  it("rejects a missing protocol header and a header that does not match the 2026 body", async () => {
    const { app } = testApp();
    const missing = await app.request("/mcp", request2026({ protocolHeader: null }));
    expect(missing.status).toBe(400);
    expect(await readJson(missing)).toMatchObject({
      error: { code: -32020, message: "Header mismatch: MCP-Protocol-Version" },
    });
    const mismatched = await app.request(
      "/mcp",
      request2026({
        meta: { "io.modelcontextprotocol/protocolVersion": "2025-11-25" },
      }),
    );
    expect(mismatched.status).toBe(400);
    expect(await readJson(mismatched)).toMatchObject({
      error: { code: -32020, message: "Header mismatch: MCP-Protocol-Version" },
    });
  });

  it("rejects a 2026 method or tool name that disagrees with the body", async () => {
    const { app } = testApp();
    const method = await app.request("/mcp", request2026({ methodHeader: "tools/call" }));
    expect(method.status).toBe(400);
    expect((await readJson(method)).error).toMatchObject({ code: -32020, message: "Header mismatch: Mcp-Method" });

    const missingName = await app.request("/mcp", request2026({ method: "tools/call", name: "ping", nameHeader: null }));
    expect(missingName.status).toBe(400);

    const wrongName = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "ping", nameHeader: "other" }),
    );
    expect(wrongName.status).toBe(400);
    expect(await readJson(wrongName)).toMatchObject({ error: { message: "Header mismatch: Mcp-Name" } });
  });

  it("accepts a base64 Mcp-Name that decodes to the body name, and rejects one that does not", async () => {
    expect(decodeMirroredName("=?base64?cGluZw==?=")).toBe("ping");
    const { app } = testApp();
    const encoded = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "ping", nameHeader: "=?base64?cGluZw==?=" }),
    );
    expect(encoded.status).toBe(401);
    const lied = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "ping", nameHeader: "=?base64?b3RoZXI=?=" }),
    );
    expect(lied.status).toBe(400);
  });

  it("lets a 2025-11-25 request through without Mcp-Method and still requires auth", async () => {
    const { app, guard } = testApp();
    const res = await app.request("/mcp", request2025Initialize());
    expect(res.status).toBe(401);
    expect(guard.calls.audits[0]).toMatchObject({
      protocolVersion: "2025-11-25",
      method: "initialize",
      clientName: "LegacyClient",
      result: "denied",
    });

    const mismatch = await app.request("/mcp", {
      ...request2025Initialize(),
      headers: { ...request2025Initialize().headers, "mcp-method": "tools/list" },
    });
    expect(mismatch.status).toBe(400);
  });

  it("answers GET and DELETE with 405 and does not echo a legacy session id", async () => {
    const { app } = testApp();
    for (const method of ["GET", "DELETE"]) {
      const res = await app.request("/mcp", {
        method,
        headers: { origin: "https://agents.cerevex.test", "mcp-session-id": "session-1", "last-event-id": "9" },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.headers.get("mcp-session-id")).toBeNull();
    }
  });

  it("rejects a body over the cap and a non-json content type", async () => {
    const { app } = testApp();
    const oversized = await app.request("/mcp", {
      method: "POST",
      headers: { origin: "https://agents.cerevex.test", "content-type": "application/json" },
      body: `{"pad":"${"a".repeat(70_000)}"}`,
    });
    expect(oversized.status).toBe(400);
    const text = await app.request("/mcp", {
      method: "POST",
      headers: { origin: "https://agents.cerevex.test", "content-type": "text/plain" },
      body: "{}",
    });
    expect(text.status).toBe(400);
  });

  it("does not depend on a database client", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    expect(names).not.toContain("pg");
    expect(names).not.toContain("drizzle-orm");
    expect(names).not.toContain("@tharros/ads-shared");
  });
});
