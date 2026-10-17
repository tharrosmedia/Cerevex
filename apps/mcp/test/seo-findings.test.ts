import { describe, expect, it } from "vitest";
import type { McpAuthenticator } from "../src/auth";
import { readJson, request2026, testApp } from "./helpers";
import type { GuardClient, McpReadRequest, McpReadResponse } from "../src/guards";

const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const STORE_ID = "82f1a547-f3df-41a9-80cd-bf2cfa270bf7";
const HOME_ID = "00000000-0000-4000-8000-000000000004";
const PATH_ID = "00000000-0000-4000-8000-000000000012";

function authenticator(): McpAuthenticator {
  return () => ({ ok: true, identity: { id: IDENTITY_ID, name: "example-agent", scopes: ["cerevex.read"] } });
}

describe("get_seo_findings detail", () => {
  it("keeps path handles and returns the safe detail fields", async () => {
    const findings = Array.from({ length: 20 }, (_, index) => {
      const n = index + 1;
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      return {
        id,
        kind: "gsc_u",
        severity: "med",
        title: "Update this page",
        status: "open",
        handle: n === 4 ? "/" : n === 12 ? "/services/ac-repair" : `page-${n}`,
        summary: `People search for term ${n}.`,
        query: `term ${n}`,
        page: `https://example.com/p/${n}`,
        clicks: n,
        impressions: 100 + n,
        ctr: 0.03,
        position: 8.5,
        recommendation: "Improve the page so it can convert that request.",
        detail: { email: "person@example.com", refreshTokenEnc: "secret-token" },
      };
    });
    const guards: GuardClient = {
      async readKillSwitch() {
        return "clear";
      },
      async writeSecurityAudit() {},
      async verifyToken() {
        return null;
      },
      async readGranted(request: McpReadRequest): Promise<McpReadResponse> {
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
            findings,
          },
        };
      },
      async submitRecommendation() {
        return { ok: false, status: 404 };
      },
    };
    const { app } = testApp({ guards, authenticator: authenticator() });
    const res = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        name: "get_seo_findings",
        arguments: { clientId: CLIENT_ID, limit: 50, status: "open" },
        authorization: "Bearer cxm_read",
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const payload = JSON.parse((body.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      returned: number;
      findings: Array<{ id: string; handle: string | null; query: string; recommendation: string }>;
    };
    expect(payload.returned).toBe(20);
    expect(payload.findings.find((finding) => finding.id === HOME_ID)?.handle).toBe("/");
    expect(payload.findings.find((finding) => finding.id === PATH_ID)?.handle).toBe("/services/ac-repair");
    expect(payload.findings[0]?.query).toBe("term 1");
    expect(payload.findings[0]?.recommendation).toContain("convert");
    const text = JSON.stringify(payload);
    expect(text).not.toContain("person@example.com");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("refreshTokenEnc");
    expect(text).not.toContain('"detail"');
  });
});
