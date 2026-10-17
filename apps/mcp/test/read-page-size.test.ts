import { describe, expect, it } from "vitest";
import { MCP_READ_DEFAULT_LIMIT, MCP_READ_MAX_LIMIT } from "@cerevex/contracts";
import { IDENTITY_CALLS_PER_MINUTE } from "../src/app";
import type { McpAuthenticator } from "../src/auth";
import { readToolDefinitions } from "../src/reads";
import { readJson, request2026, testApp } from "./helpers";
import type { GuardClient, McpReadRequest } from "../src/guards";

const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

function authenticator(): McpAuthenticator {
  return () => ({ ok: true, identity: { id: IDENTITY_ID, name: "example-agent", scopes: ["cerevex.read"] } });
}

describe("read page size", () => {
  it("publishes a default of 100 and a maximum of 500", () => {
    expect(MCP_READ_DEFAULT_LIMIT).toBe(100);
    expect(MCP_READ_MAX_LIMIT).toBe(500);
    for (const tool of readToolDefinitions()) {
      expect(tool.inputSchema.properties.limit).toMatchObject({ default: 100, maximum: 500, minimum: 1 });
    }
  });

  it("does not raise the per-identity call window", () => {
    expect(IDENTITY_CALLS_PER_MINUTE).toBe(60);
  });

  it("forwards a page of 500 and rejects 501", async () => {
    const reads: McpReadRequest[] = [];
    const guards: GuardClient = {
      async readKillSwitch() {
        return "clear";
      },
      async writeSecurityAudit() {},
      async verifyToken() {
        return null;
      },
      async readGranted(request) {
        reads.push(request);
        return {
          ok: true,
          read: {
            clientId: request.clientId,
            storeId: "44444444-4444-4444-8444-444444444444",
            lastSyncedAt: null,
            sourceSystem: "brain",
            availability: "ready",
            limit: request.limit,
            nextCursor: null,
            products: [],
            collections: [],
          },
        };
      },
      async submitRecommendation() {
        return { ok: false, status: 404 };
      },
    };
    const { app } = testApp({ guards, authenticator: authenticator() });
    const accepted = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID, limit: 500 },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(accepted.status).toBe(200);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.limit).toBe(500);

    const omitted = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 2,
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(omitted.status).toBe(200);
    expect(reads[1]?.limit).toBe(100);

    const rejected = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 3,
        name: "get_store_catalog",
        arguments: { clientId: CLIENT_ID, limit: 501 },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(rejected.status).toBe(400);
    expect((await readJson(rejected)).error).toMatchObject({ message: "Invalid arguments" });
    expect(reads).toHaveLength(2);
  });
});
