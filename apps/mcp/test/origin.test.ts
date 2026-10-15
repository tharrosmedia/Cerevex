import { describe, expect, it } from "vitest";
import { canonicalOrigin, classifyOrigin, parseAllowedOrigins } from "../src/origin";
import { readJson, request2026, testApp } from "./helpers";

const ALLOWED = "https://agents.cerevex.test";

describe("origin canonicalization", () => {
  const allowed = parseAllowedOrigins(
    ` ${ALLOWED} , HTTPS://Other.Example:8443 , https://dropped.example/path , *, https://user:pass@agents.cerevex.test `,
  );

  const cases: Array<{ origin: string | null; expected: "absent" | "allowed" | "rejected" }> = [
    { origin: null, expected: "absent" },
    { origin: ALLOWED, expected: "allowed" },
    { origin: " HTTPS://Agents.Cerevex.TEST ", expected: "allowed" },
    { origin: "https://agents.cerevex.test/", expected: "allowed" },
    { origin: "https://agents.cerevex.test:443", expected: "allowed" },
    { origin: "https://other.example:8443", expected: "allowed" },
    { origin: "https://other.example", expected: "rejected" },
    { origin: "https://other.example:443", expected: "rejected" },
    { origin: "http://agents.cerevex.test", expected: "rejected" },
    { origin: "https://agents.cerevex.test.evil.example", expected: "rejected" },
    { origin: "https://notagents.cerevex.test", expected: "rejected" },
    { origin: "https://agents.cerevex.test/mcp", expected: "rejected" },
    { origin: "https://agents.cerevex.test?x=1", expected: "rejected" },
    { origin: "https://agents.cerevex.test#https://agents.cerevex.test", expected: "rejected" },
    { origin: "https://evil.example", expected: "rejected" },
    { origin: "https://user:pass@agents.cerevex.test", expected: "rejected" },
    { origin: "https://evil.example@agents.cerevex.test", expected: "rejected" },
    { origin: "https://agents.cerevex.test\\@evil.example", expected: "rejected" },
    { origin: "null", expected: "rejected" },
    { origin: "*", expected: "rejected" },
    { origin: "", expected: "rejected" },
    { origin: "https://agents.cerevex.test, https://evil.example", expected: "rejected" },
    { origin: "http://127.0.0.1", expected: "rejected" },
    { origin: "http://127.0.0.1:4320", expected: "rejected" },
    { origin: "http://localhost", expected: "rejected" },
    { origin: "file://agents.cerevex.test", expected: "rejected" },
    { origin: "https://a.cerevex.test", expected: "rejected" },
    { origin: "https://agents.cerevex.test\t.evil.example", expected: "rejected" },
    { origin: "https://agents.cerevex.test\r\nhttps://evil.example", expected: "rejected" },
    { origin: "https://agents.cerevex.test%00.evil.example", expected: "rejected" },
    { origin: "https://agents.cerevex.test.", expected: "rejected" },
  ];

  for (const testCase of cases) {
    it(`classifies ${JSON.stringify(testCase.origin)} as ${testCase.expected}`, () => {
      expect(classifyOrigin(testCase.origin, allowed)).toBe(testCase.expected);
    });
  }

  it("drops allowlist entries that are not bare origins and ignores a wildcard", () => {
    expect(canonicalOrigin("https://agents.cerevex.test/mcp")).toBeNull();
    expect(canonicalOrigin("*")).toBeNull();
    expect(canonicalOrigin("https://*.cerevex.test")).toBeNull();
    expect([...parseAllowedOrigins("https://*.cerevex.test, *, https://agents.cerevex.test/mcp")]).toEqual([]);
    expect(classifyOrigin("https://a.cerevex.test", parseAllowedOrigins("https://*.cerevex.test"))).toBe("rejected");
  });

  it("does not let a 33rd allowlist entry open an origin", () => {
    const many = Array.from({ length: 33 }, (_, index) => `https://ok${index}.example`).join(",");
    const allowedOrigins = parseAllowedOrigins(many);
    expect(allowedOrigins.size).toBe(32);
    expect(classifyOrigin("https://ok32.example", allowedOrigins)).toBe("rejected");
    expect(classifyOrigin("https://ok0.example", allowedOrigins)).toBe("allowed");
  });

  it("rejects an empty allowlist for every present origin", () => {
    const empty = parseAllowedOrigins(undefined);
    expect(classifyOrigin("https://agents.cerevex.test", empty)).toBe("rejected");
    expect(classifyOrigin(null, empty)).toBe("absent");
    expect(classifyOrigin(undefined, empty)).toBe("absent");
  });
});

describe("POST /mcp origin rejection", () => {
  it("returns 403 without echoing the origin or consulting auth and the kill switch", async () => {
    let authed = 0;
    const { app, guard } = testApp({
      authenticator: () => {
        authed += 1;
        return { ok: false };
      },
    });
    const evil = "https://evil.example";
    const res = await app.request("/mcp", request2026({ origin: evil, authorization: "Bearer token" }));
    const text = await res.text();
    expect(res.status).toBe(403);
    expect(text).toContain("Origin not allowed");
    expect(text).not.toContain(evil);
    expect(text).not.toContain("Authentication required");
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(authed).toBe(0);
    expect(guard.calls.kill).toBe(0);
    expect(guard.calls.audits).toEqual([
      expect.objectContaining({ reason: "origin", result: "denied", httpStatus: 403, method: null, tool: null }),
    ]);
    expect(JSON.stringify(guard.calls.audits[0])).not.toContain(evil);
  });

  it("allows a missing origin through to auth and rejects a present origin that is only a suffix match", async () => {
    const { app } = testApp();
    const missing = await app.request("/mcp", request2026({ origin: null }));
    expect(missing.status).toBe(401);
    const suffix = await app.request("/mcp", request2026({ origin: "https://agents.cerevex.test.evil.example" }));
    expect(suffix.status).toBe(403);
    expect(await readJson(suffix)).toMatchObject({ id: null, error: { message: "Origin not allowed" } });
  });

  it("does not apply the origin check to /health", async () => {
    const { app, guard } = testApp();
    const res = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "cerevex-mcp" });
    expect(guard.calls.audits).toHaveLength(0);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("checks origin before the method allow list", async () => {
    const { app } = testApp();
    const res = await app.request("/mcp", { method: "GET", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not allowed");
  });
});
