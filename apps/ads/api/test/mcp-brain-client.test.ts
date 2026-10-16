import { describe, expect, it } from "vitest";
import { fetchBrainMcpRead, type BrainReadRequest } from "../src/mcp-brain-client";

const IDENTITY = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const STORE = "44444444-4444-4444-8444-444444444444";
const KEY = "ads-brain-read-key";

const request: BrainReadRequest = {
  tool: "get_store_catalog",
  identityId: IDENTITY,
  clientId: CLIENT,
  limit: 10,
  cursor: null,
};

function catalog(clientId: string) {
  return {
    ok: true,
    read: {
      clientId,
      storeId: STORE,
      lastSyncedAt: null,
      sourceSystem: "brain",
      availability: "ready",
      limit: 10,
      nextCursor: null,
      products: [{ handle: "foreign-sku", title: "Foreign catalog row" }],
      collections: [],
    },
  };
}

function fetchReturning(status: number, body: unknown, seen: { init?: RequestInit }) {
  return (async (_url: string, init?: RequestInit) => {
    seen.init = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("Brain read client", () => {
  it("rejects a non-2xx body even when the JSON would otherwise be a read", async () => {
    const seen: { init?: RequestInit } = {};
    const result = await fetchBrainMcpRead(request, {
      origin: "http://brain.test",
      internalKey: KEY,
      fetchImpl: fetchReturning(500, catalog(CLIENT), seen),
    });
    expect(result).toEqual({ ok: false, status: 500 });
    expect(JSON.stringify(result)).not.toContain("Foreign catalog row");
    expect(seen.init?.redirect).toBe("manual");
  });

  it("rejects a 2xx body whose ok flag is false", async () => {
    const seen: { init?: RequestInit } = {};
    const result = await fetchBrainMcpRead(request, {
      origin: "http://brain.test",
      internalKey: KEY,
      fetchImpl: fetchReturning(200, { ok: false, read: catalog(CLIENT).read }, seen),
    });
    expect(result).toEqual({ ok: false, status: 500 });
    expect(JSON.stringify(result)).not.toContain("Foreign catalog row");
  });

  it("does not follow a redirect", async () => {
    const seen: { init?: RequestInit } = {};
    const result = await fetchBrainMcpRead(request, {
      origin: "http://brain.test",
      internalKey: KEY,
      fetchImpl: fetchReturning(302, catalog(CLIENT), seen),
    });
    expect(seen.init?.method).toBe("GET");
    expect(seen.init?.redirect).toBe("manual");
    expect(result).toEqual({ ok: false, status: 500 });
    expect(JSON.stringify(result)).not.toContain("Foreign catalog row");
  });

  it("rejects a read for a different client", async () => {
    const seen: { init?: RequestInit } = {};
    const result = await fetchBrainMcpRead(request, {
      origin: "http://brain.test",
      internalKey: KEY,
      fetchImpl: fetchReturning(200, catalog(OTHER), seen),
    });
    expect(result).toEqual({ ok: false, status: 500 });
    expect(JSON.stringify(result)).not.toContain(OTHER);
    expect(JSON.stringify(result)).not.toContain("Foreign catalog row");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
