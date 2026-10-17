import { describe, expect, it } from "vitest";
import type { McpAuthenticator } from "../src/auth";
import { readToolDefinitions } from "../src/reads";
import { readJson, request2026, testApp } from "./helpers";
import type { McpReadRequest, McpReadResponse } from "../src/guards";

const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const NOW = Date.UTC(2026, 9, 16);

function authenticator(): McpAuthenticator {
  return () => ({ ok: true, identity: { id: IDENTITY_ID, name: "example-agent", scopes: ["cerevex.read"] } });
}

function appFor(read: (request: McpReadRequest) => McpReadResponse) {
  const reads: McpReadRequest[] = [];
  const { app } = testApp({
    authenticator: authenticator(),
    now: () => NOW,
    guards: {
      async readKillSwitch() {
        return "clear";
      },
      async writeSecurityAudit() {},
      async verifyToken() {
        return null;
      },
      async readGranted(request) {
        reads.push(request);
        return read(request);
      },
      async submitRecommendation() {
        return { ok: false, status: 404 };
      },
    },
  });
  return { app, reads };
}

function ready(request: McpReadRequest, extra: Record<string, unknown>): McpReadResponse {
  return {
    ok: true,
    read: {
      clientId: request.clientId,
      storeId: STORE_ID,
      lastSyncedAt: "2026-10-16T12:00:00.000Z",
      sourceSystem: "brain",
      availability: "ready",
      limit: request.limit,
      nextCursor: null,
      ...extra,
    },
  };
}

describe("get_gsc_performance views", () => {
  it("accepts view pages and starts that section without a cursor", async () => {
    const { app, reads } = appFor((request) =>
      ready(request, {
        pages: [{ page: "https://example.com/heat", clicks: 1, impressions: 4, ctr: 0.25, position: 2 }],
      }),
    );
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, view: "pages", limit: 1 },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.error).toBeUndefined();
    const payload = JSON.parse((body.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      view: string;
      pages: unknown[];
      queries?: unknown[];
    };
    expect(payload.view).toBe("pages");
    expect(payload.pages).toHaveLength(1);
    expect(payload.queries).toBeUndefined();
    expect(reads[0]).toMatchObject({ view: "pages", cursor: null });
    expect(JSON.stringify(body.error ?? {})).not.toContain("-32602");
  });

  it("rejects a query cursor on view pages and a page cursor on view both", async () => {
    const { app, reads } = appFor(() => ({ ok: false, status: 500 }));
    const pages = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, view: "pages", cursor: "gq0" },
        authorization: "Bearer cxm_read",
      }),
    );
    const both = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 2,
        name: "get_gsc_performance",
        arguments: { clientId: CLIENT_ID, view: "both", cursor: "gp3" },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(pages.status).toBe(400);
    expect(both.status).toBe(400);
    expect((await readJson(pages)).error).toMatchObject({ code: -32602, message: "Invalid arguments" });
    expect((await readJson(both)).error).toMatchObject({ code: -32602 });
    expect(reads).toHaveLength(0);
  });

  it("documents both as two sections in the tool description", () => {
    const tool = readToolDefinitions().find((item) => item.name === "get_gsc_performance");
    expect(tool?.description).toContain("view 'both'");
    expect(tool?.description).toContain("queries and pages");
    expect(tool?.inputSchema.properties).toMatchObject({
      view: { enum: ["queries", "pages", "both"] },
    });
  });
});
