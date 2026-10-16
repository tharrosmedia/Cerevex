import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { McpAuthenticator } from "../src/auth";
import type { SecurityAuditEntry } from "../src/audit";
import {
  createHttpGuardClient,
  type GuardClient,
  type McpSubmitResponse,
} from "../src/guards";
import type { McpSubmitRequest } from "@cerevex/contracts";
import { readJson, request2026, testApp } from "./helpers";

const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const REC_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE = "agent:example-agent";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function authenticator(scopes: Array<"cerevex.read" | "cerevex.recs.submit">): McpAuthenticator {
  return () => ({ ok: true, identity: { id: IDENTITY_ID, name: "example-agent", scopes } });
}

function guardFor(submit: (request: McpSubmitRequest) => Promise<McpSubmitResponse> | McpSubmitResponse) {
  const submits: McpSubmitRequest[] = [];
  const audits: SecurityAuditEntry[] = [];
  const guards: GuardClient = {
    async readKillSwitch() {
      return "clear";
    },
    async writeSecurityAudit(entry) {
      audits.push(entry);
    },
    async verifyToken() {
      return null;
    },
    async readGranted() {
      return { ok: false, status: 404 };
    },
    async submitRecommendation(request) {
      submits.push(request);
      return submit(request);
    },
  };
  return { guards, submits, audits };
}

function pending(outcome: "created" | "duplicate", extra: Record<string, unknown> = {}): McpSubmitResponse {
  return {
    ok: true,
    recommendation: {
      id: REC_ID,
      outcome,
      status: "proposed",
      approvalStatus: "PENDING_APPROVAL",
      source: SOURCE,
      apply: true,
      proposedMutations: [{ action: "pause" }],
      ...extra,
    },
  };
}

function textOf(body: Record<string, unknown>): Record<string, unknown> {
  const result = body.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function submitCall(name = "submit_recommendation", args: unknown = validArgs(), authorization = "Bearer cxm_submit") {
  return request2026({
    method: "tools/call",
    name,
    arguments: args,
    authorization,
  });
}

function validArgs(extra: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    idempotencyKey: "retry-key-00000001",
    type: "improve_ctr",
    title: "Rewrite the heating page title",
    rationale: "The title does not say what the page offers.",
    ...extra,
  };
}

describe("submit_recommendation", () => {
  it("does not call the façade when the caller is unauthenticated", async () => {
    let submits = 0;
    const { guards } = guardFor(() => {
      submits += 1;
      return pending("created");
    });
    const { app } = testApp({ guards });
    const res = await app.request("/mcp", submitCall("submit_recommendation", validArgs(), undefined as unknown as string));
    const unauthenticated = await app.request(
      "/mcp",
      request2026({ method: "tools/call", name: "submit_recommendation", arguments: validArgs() }),
    );
    expect(res.status).toBe(401);
    expect(unauthenticated.status).toBe(401);
    expect(submits).toBe(0);
  });

  it("returns 403 insufficient_scope without cerevex.recs.submit and does not write", async () => {
    let submits = 0;
    const { guards, audits } = guardFor(() => {
      submits += 1;
      return pending("created");
    });
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.read"]) });
    const res = await app.request("/mcp", submitCall());
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope", scope="cerevex.recs.submit"');
    expect(await readJson(res)).toMatchObject({ error: { message: "insufficient_scope" } });
    expect(submits).toBe(0);
    expect(audits.at(-1)).toMatchObject({
      reason: "insufficient_scope",
      result: "denied",
      httpStatus: 403,
      tool: "submit_recommendation",
    });
  });

  it("denies an ungranted client the same way as one that does not exist", async () => {
    const { guards, submits, audits } = guardFor(() => ({ ok: false, status: 404 }));
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const denied = await app.request("/mcp", submitCall());
    const missing = await app.request(
      "/mcp",
      request2026({
        method: "tools/call",
        id: 2,
        name: "submit_recommendation",
        arguments: validArgs({ clientId: OTHER_CLIENT_ID }),
        authorization: "Bearer cxm_submit",
      }),
    );
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    const deniedBody = await readJson(denied);
    const missingBody = await readJson(missing);
    expect(deniedBody.error).toEqual({ code: -32000, message: "not found or not allowed" });
    expect(missingBody.error).toEqual(deniedBody.error);
    expect(JSON.stringify(deniedBody)).not.toContain(CLIENT_ID);
    expect(JSON.stringify(missingBody)).not.toContain(OTHER_CLIENT_ID);
    expect(JSON.stringify(audits)).not.toContain(CLIENT_ID);
    expect(audits.at(-1)).toMatchObject({
      reason: "not_granted",
      result: "denied",
      httpStatus: 404,
      tool: "submit_recommendation",
    });
    expect(submits).toHaveLength(2);
  });

  it("blocks the submit when the kill switch is tripped and writes nothing", async () => {
    let submits = 0;
    const { guards, audits } = guardFor(() => {
      submits += 1;
      return pending("created");
    });
    guards.readKillSwitch = async () => "tripped";
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const res = await app.request("/mcp", submitCall());
    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({ error: { message: "Connector is off" } });
    expect(submits).toBe(0);
    expect(audits.at(-1)).toMatchObject({ reason: "kill_switch", result: "denied", tool: null });
  });

  it("rejects an apply field, a spoofed source, a bad type, and an oversized title before the façade", async () => {
    let submits = 0;
    const { guards } = guardFor(() => {
      submits += 1;
      return pending("created");
    });
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const cases = [
      validArgs({ apply: true }),
      validArgs({ source: "agent:someone-else" }),
      validArgs({ type: "publish" }),
      validArgs({ title: "x".repeat(201) }),
      validArgs({ rationale: "Write to person@example.com today." }),
      validArgs({ idempotencyKey: "short" }),
    ];
    for (const args of cases) {
      const res = await app.request("/mcp", submitCall("submit_recommendation", args));
      expect(res.status).toBe(400);
      expect(await readJson(res)).toMatchObject({ error: { message: "Invalid arguments" } });
    }
    expect(submits).toBe(0);
  });

  it("creates a pending recommendation and drops apply fields from the reply", async () => {
    const { guards, submits, audits } = guardFor((request) => {
      expect(request.identityId).toBe(IDENTITY_ID);
      expect(request).not.toHaveProperty("apply");
      return pending("created");
    });
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const res = await app.request("/mcp", submitCall());
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const payload = textOf(body);
    expect(payload).toEqual({
      outcome: "created",
      recommendationId: REC_ID,
      status: "proposed",
      approvalStatus: "PENDING_APPROVAL",
      source: SOURCE,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("pause");
    expect(text).not.toContain('"apply"');
    expect(text).not.toContain("proposedMutations");
    expect(audits.at(-1)).toMatchObject({
      result: "ok",
      httpStatus: 200,
      reason: "call",
      tool: "submit_recommendation",
      identityId: IDENTITY_ID,
      identityName: "example-agent",
    });
    expect(JSON.stringify(audits.at(-1))).not.toContain("Rewrite the heating");
    expect(submits).toHaveLength(1);
  });

  it("returns the original recommendation when the façade says the key was already used", async () => {
    const seen: string[] = [];
    const { guards } = guardFor((request) => {
      seen.push(request.idempotencyKey);
      return pending(seen.length === 1 ? "created" : "duplicate");
    });
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const first = textOf(await readJson(await app.request("/mcp", submitCall())));
    const second = textOf(
      await readJson(
        await app.request(
          "/mcp",
          request2026({
            method: "tools/call",
            id: 2,
            name: "submit_recommendation",
            arguments: validArgs({ title: "A different title must not create another rec" }),
            authorization: "Bearer cxm_submit",
          }),
        ),
      ),
    );
    expect(first.outcome).toBe("created");
    expect(second).toMatchObject({ outcome: "duplicate", recommendationId: REC_ID, status: "proposed" });
    expect(second.recommendationId).toBe(first.recommendationId);
    expect(seen).toEqual(["retry-key-00000001", "retry-key-00000001"]);
  });

  it("maps a façade scope denial and a façade kill switch without returning a rec", async () => {
    const scope = guardFor(() => ({ ok: false, status: 403, error: "insufficient_scope" }));
    const scoped = testApp({ guards: scope.guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const denied = await scoped.app.request("/mcp", submitCall());
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain("cerevex.recs.submit");
    expect(JSON.stringify(await readJson(denied))).not.toContain(REC_ID);

    const killed = guardFor(() => ({ ok: false, status: 403, error: "kill_switch" }));
    const off = testApp({ guards: killed.guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const blocked = await off.app.request("/mcp", submitCall());
    expect(blocked.status).toBe(403);
    expect(await readJson(blocked)).toMatchObject({ error: { message: "Connector is off" } });
    expect(killed.audits.at(-1)).toMatchObject({ reason: "kill_switch", tool: "submit_recommendation" });
  });

  it("refuses a created payload that is already authorized", async () => {
    const { guards } = guardFor(() => pending("created", { status: "authorized", approvalStatus: "approved" }));
    const { app } = testApp({ guards, authenticator: authenticator(["cerevex.recs.submit"]) });
    const res = await app.request("/mcp", submitCall());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("Submit unavailable");
    expect(text).not.toContain(REC_ID);
    expect(text).not.toContain("authorized");
  });

  it("has no approve or apply path in the submit implementation", () => {
    const files = [
      "apps/mcp/src/submit.ts",
      "apps/ads/api/src/mcp-submit.ts",
      "apps/ads/shared/src/mcp-recommendations.ts",
    ];
    const forbidden = [
      /from\s+["'][^"']*\/apply["']/,
      /from\s+["'][^"']*\/approve["']/,
      /from\s+["'][^"']*mutate/,
      /createApplyJob/,
      /\/recommendations\/:id\/apply/,
      /\/recommendations\/:id\/decide/,
      /kind:\s*"approved"/,
      /kind:\s*"applied"/,
      /shopify/i,
      /graph\.facebook/,
      /googleads/i,
      /inngest/i,
    ];
    const combined = files.map((file) => readFileSync(`${repoRoot}${file}`, "utf8")).join("\n");
    for (const pattern of forbidden) {
      expect(combined).not.toMatch(pattern);
    }
    expect(combined).toContain("proposedMutations: []");
    expect(combined).toContain('actorType: "agent"');
    expect(combined).toContain("actorId: null");
    expect(combined).not.toMatch(/status:\s*"authorized"/);
  });

  it("posts the submit to the ads façade and keeps not-found bodies identical", async () => {
    const seen: string[] = [];
    const client = createHttpGuardClient({
      apiUrl: "http://127.0.0.1:43180",
      mcpKey: "mcp-key",
      fetchImpl: async (url, init) => {
        seen.push(String(url));
        expect(String(init?.body)).not.toContain("mcp-key");
        expect(new Headers(init?.headers).get("x-cerevex-mcp-key")).toBe("mcp-key");
        const message = seen.length === 1 ? "Client not found" : "no grant";
        return new Response(JSON.stringify({ ok: false, message }), { status: 404 });
      },
    });
    const request: McpSubmitRequest = {
      identityId: IDENTITY_ID,
      clientId: CLIENT_ID,
      idempotencyKey: "retry-key-00000001",
      type: "improve_ctr",
      title: "Rewrite the heating page title",
      rationale: "The title does not say what the page offers.",
    };
    expect(await client.submitRecommendation(request)).toEqual({ ok: false, status: 404 });
    expect(await client.submitRecommendation({ ...request, clientId: OTHER_CLIENT_ID })).toEqual({ ok: false, status: 404 });
    expect(seen).toEqual([
      "http://127.0.0.1:43180/internal/mcp/submit",
      "http://127.0.0.1:43180/internal/mcp/submit",
    ]);
  });
});
