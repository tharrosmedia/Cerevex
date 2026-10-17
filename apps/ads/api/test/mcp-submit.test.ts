import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { MCP_RECOMMENDATION_TYPES } from "@cerevex/contracts";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { RECOMMENDATION_TYPES } from "@tharros/ads-shared";
import {
  applyJobs,
  authorizations,
  clientAuditLog,
  clients,
  decisions,
  mcpIdentities,
  mcpIdentityGrants,
  recommendations,
  workspaces,
} from "@tharros/ads-shared/schema";
import { app, json, login } from "./helpers";

const INTERNAL_KEY = "submit-internal-key";
const MCP_KEY = "submit-mcp-key";
const MISSING_CLIENT_ID = "99999999-9999-4999-8999-999999999999";
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("mcp submit façade", () => {
  let ownerToken = "";
  let workspaceId = "";
  let clientId = "";
  let secondClientId = "";
  let ungrantedClientId = "";
  let otherClientId = "";
  let submitIdentityId = "";
  let submitName = "";
  let readIdentityId = "";
  let peerIdentityId = "";
  let foreignIdentityId = "";
  let revokedIdentityId = "";
  let originalSettings: unknown = {};
  const clientName = `Submit grant ${Date.now().toString(36)}`;
  const original = {
    key: process.env.ADS_INTERNAL_KEY,
    mcp: process.env.MCP_SERVICE_KEY,
    workspace: process.env.ADS_INTERNAL_WORKSPACE_ID,
  };

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.MCP_SERVICE_KEY = MCP_KEY;
    ownerToken = (
      await login(process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com", process.env.SEED_OWNER_PASSWORD ?? "local-dev-only")
    ).token;
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    originalSettings = workspace.settingsJson;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    await db
      .update(workspaces)
      .set({ settingsJson: settingsWith(workspace.settingsJson, false) })
      .where(eq(workspaces.id, workspaceId));

    const [client] = await db
      .insert(clients)
      .values({ workspaceId, name: clientName, status: "active" })
      .returning();
    const [second] = await db
      .insert(clients)
      .values({ workspaceId, name: `${clientName} second`, status: "active" })
      .returning();
    const [ungranted] = await db
      .insert(clients)
      .values({ workspaceId, name: `${clientName} other`, status: "active" })
      .returning();
    const [otherWorkspace] = await db.insert(workspaces).values({ name: `${clientName} workspace` }).returning();
    const [otherClient] = await db
      .insert(clients)
      .values({ workspaceId: otherWorkspace!.id, name: `${clientName} foreign`, status: "active" })
      .returning();
    if (!client || !second || !ungranted || !otherWorkspace || !otherClient) throw new Error("clients missing");
    clientId = client.id;
    secondClientId = second.id;
    ungrantedClientId = ungranted.id;
    otherClientId = otherClient.id;

    submitName = `s${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    submitIdentityId = await createIdentity(submitName, ["cerevex.recs.submit"], clientId);
    await db.insert(mcpIdentityGrants).values({ identityId: submitIdentityId, clientId: secondClientId });
    readIdentityId = await createIdentity(`r${randomUUID().replace(/-/g, "").slice(0, 24)}`, ["cerevex.read"], clientId);
    peerIdentityId = await createIdentity(`p${randomUUID().replace(/-/g, "").slice(0, 24)}`, ["cerevex.recs.submit"], ungrantedClientId);
    revokedIdentityId = await createIdentity(`v${randomUUID().replace(/-/g, "").slice(0, 24)}`, ["cerevex.recs.submit"], clientId);
    const foreignName = `f${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const [foreign] = await db
      .insert(mcpIdentities)
      .values({
        workspaceId: otherWorkspace.id,
        name: foreignName,
        displayName: foreignName,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        scopes: ["cerevex.recs.submit"],
      })
      .returning();
    if (!foreign) throw new Error("foreign identity missing");
    foreignIdentityId = foreign.id;
    await db.insert(mcpIdentityGrants).values([
      { identityId: readIdentityId, clientId: otherClientId },
      { identityId: foreignIdentityId, clientId },
    ]);
    const revoked = await app.request(`/mcp/identities/${revokedIdentityId}/revoke`, {
      method: "POST",
      headers: owner(),
    });
    expect(revoked.status).toBe(200);
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      await db.update(workspaces).set({ settingsJson: originalSettings as never }).where(eq(workspaces.id, workspaceId));
      await db.delete(mcpIdentities).where(eq(mcpIdentities.workspaceId, workspaceId));
    }
    if (foreignIdentityId) await db.delete(mcpIdentities).where(eq(mcpIdentities.id, foreignIdentityId));
    const createdClients = [clientId, secondClientId, ungrantedClientId, otherClientId].filter((id) => id.length > 0);
    if (createdClients.length > 0) {
      // The rec audit is append-only. This test removes only the rows it wrote, then turns the trigger back on.
      await db.execute(sql`ALTER TABLE "os"."client_audit_log" DISABLE TRIGGER "client_audit_log_no_delete"`);
      try {
        await db.delete(clientAuditLog).where(inArray(clientAuditLog.clientId, createdClients));
      } finally {
        await db.execute(sql`ALTER TABLE "os"."client_audit_log" ENABLE TRIGGER "client_audit_log_no_delete"`);
      }
      await db.delete(clients).where(inArray(clients.id, createdClients));
    }
    if (original.key === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = original.key;
    if (original.mcp === undefined) delete process.env.MCP_SERVICE_KEY;
    else process.env.MCP_SERVICE_KEY = original.mcp;
    if (original.workspace === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = original.workspace;
    await closeDb();
  });

  function owner(jsonBody = false): Record<string, string> {
    return {
      authorization: `Bearer ${ownerToken}`,
      ...(jsonBody ? { "content-type": "application/json" } : {}),
    };
  }

  async function createIdentity(name: string, scopes: Array<"cerevex.read" | "cerevex.recs.submit">, grantedClientId: string) {
    const created = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ displayName: name, scopes, clientIds: [grantedClientId] }),
    });
    expect(created.status).toBe(200);
    const body = await json(created);
    return String((body.identity as { id: string }).id);
  }

  function bodyFor(identityId: string, grantedClientId: string, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      identityId,
      clientId: grantedClientId,
      idempotencyKey: "retry-key-00000001",
      type: "improve_ctr",
      title: "Rewrite the heating page title",
      rationale: "The title does not say what the page offers.",
      ...extra,
    });
  }

  async function postSubmit(body: string, headers: Record<string, string> = { "x-cerevex-mcp-key": MCP_KEY }) {
    return app.request("/internal/mcp/submit", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }

  it("pins the submit types to the existing recommendation types", () => {
    expect([...MCP_RECOMMENDATION_TYPES]).toEqual([...RECOMMENDATION_TYPES]);
  });

  it("refuses the Brain key, an owner session, and a query-string key", async () => {
    const body = bodyFor(submitIdentityId, clientId);
    const brain = await postSubmit(body, { "x-cerevex-internal-key": INTERNAL_KEY });
    const ownerCall = await postSubmit(body, { authorization: `Bearer ${ownerToken}` });
    const query = await app.request(`/internal/mcp/submit?x-cerevex-mcp-key=${MCP_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(brain.status).toBe(401);
    expect(ownerCall.status).toBe(401);
    expect(query.status).toBe(401);
  });

  it("uses one denial for an ungranted client, a missing client, a foreign client, and a revoked identity", async () => {
    const cases = [
      bodyFor(submitIdentityId, ungrantedClientId),
      bodyFor(submitIdentityId, MISSING_CLIENT_ID),
      bodyFor(submitIdentityId, otherClientId),
      bodyFor(revokedIdentityId, clientId),
    ];
    const before = await recommendationIds(clientId);
    const texts: string[] = [];
    for (const body of cases) {
      const res = await postSubmit(body);
      expect(res.status).toBe(404);
      texts.push(await res.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(JSON.stringify({ ok: false }));
    expect(texts[0]).not.toContain(clientId);
    expect(texts[0]).not.toContain(clientName);
    expect(await recommendationIds(clientId)).toEqual(before);
  });

  it("returns 403 for a read-only identity and does not write", async () => {
    const before = await recommendationIds(clientId);
    const res = await postSubmit(bodyFor(readIdentityId, clientId));
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("insufficient_scope");
    expect(text).not.toContain(clientId);
    expect(await recommendationIds(clientId)).toEqual(before);
  });

  it("rejects an apply field before anything is written", async () => {
    const before = await recommendationIds(clientId);
    const res = await postSubmit(bodyFor(submitIdentityId, clientId, { apply: true }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(JSON.stringify({ ok: false }));
    expect(await recommendationIds(clientId)).toEqual(before);
  });

  it("does not write when the env override is set, even if the workspace flag is on", async () => {
    const previous = process.env.MCP_CONNECTOR_KILL_SWITCH;
    process.env.MCP_CONNECTOR_KILL_SWITCH = "off";
    const before = await recommendationIds(clientId);
    try {
      const res = await postSubmit(bodyFor(submitIdentityId, clientId, { idempotencyKey: "retry-key-env-override1" }));
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(JSON.stringify({ ok: false, error: "kill_switch" }));
      expect(await recommendationIds(clientId)).toEqual(before);
    } finally {
      if (previous === undefined) delete process.env.MCP_CONNECTOR_KILL_SWITCH;
      else process.env.MCP_CONNECTOR_KILL_SWITCH = previous;
    }
  });

  it("does not write when the kill switch is tripped", async () => {
    const db = getDb();
    const before = await recommendationIds(clientId);
    await db
      .update(workspaces)
      .set({ settingsJson: settingsWith(originalSettings, true) })
      .where(eq(workspaces.id, workspaceId));
    try {
      const res = await postSubmit(bodyFor(submitIdentityId, clientId, { idempotencyKey: "retry-key-killed0001" }));
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(JSON.stringify({ ok: false, error: "kill_switch" }));
      expect(await recommendationIds(clientId)).toEqual(before);
    } finally {
      await db
        .update(workspaces)
        .set({ settingsJson: settingsWith(originalSettings, false) })
        .where(eq(workspaces.id, workspaceId));
    }
  });

  it("stores a pending recommendation and does not approve, apply, or open a job", async () => {
    const res = await postSubmit(bodyFor(submitIdentityId, clientId));
    expect(res.status).toBe(200);
    const body = await json(res);
    const recommendation = body.recommendation as {
      id: string;
      outcome: string;
      status: string;
      approvalStatus: string;
      source: string;
    };
    expect(recommendation).toEqual({
      id: recommendation.id,
      outcome: "created",
      status: "proposed",
      approvalStatus: "PENDING_APPROVAL",
      source: `agent:${submitName}`,
    });
    expect(JSON.stringify(body)).not.toContain("apply");
    const db = getDb();
    const [row] = await db.select().from(recommendations).where(eq(recommendations.id, recommendation.id));
    expect(row?.status).toBe("proposed");
    expect(row?.scope).toBe("client");
    expect(row?.type).toBe("improve_ctr");
    expect(row?.proposedMutationsJson).toEqual([]);
    expect(row?.approvalJson).toMatchObject({ status: "PENDING_APPROVAL", approved_by: null, executed_by: null });
    expect(row?.evidenceJson).toMatchObject({
      writes: false,
      mcp: { identityId: submitIdentityId, source: `agent:${submitName}`, idempotencyKey: "retry-key-00000001" },
    });
    expect(await db.select().from(applyJobs).where(eq(applyJobs.clientId, clientId))).toEqual([]);
    expect(await db.select().from(decisions).where(eq(decisions.recommendationId, recommendation.id))).toEqual([]);
    expect(await db.select().from(authorizations).where(eq(authorizations.recommendationId, recommendation.id))).toEqual([]);
    const [audit] = await db.select().from(clientAuditLog).where(eq(clientAuditLog.entityId, recommendation.id));
    expect(audit).toMatchObject({
      action: "rec_created",
      actorType: "agent",
      actorId: null,
      module: "mcp",
      clientId,
    });
    expect(audit?.payloadJson).toMatchObject({ source: `agent:${submitName}` });
  });

  it("returns the same recommendation when the idempotency key is retried", async () => {
    const key = "retry-key-idempotent1";
    const first = await postSubmit(bodyFor(submitIdentityId, clientId, { idempotencyKey: key }));
    const second = await postSubmit(
      bodyFor(submitIdentityId, clientId, {
        idempotencyKey: key,
        title: "A different title must not create another rec",
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const created = (await json(first)).recommendation as { id: string; outcome: string };
    const duplicate = (await json(second)).recommendation as { id: string; outcome: string; status: string };
    expect(created.outcome).toBe("created");
    expect(duplicate).toMatchObject({ id: created.id, outcome: "duplicate", status: "proposed" });
    const rows = await getDb()
      .select({ id: recommendations.id, title: recommendations.title, evidenceJson: recommendations.evidenceJson })
      .from(recommendations)
      .where(eq(recommendations.clientId, clientId));
    const keyed = rows.filter((row) => mcpKey(row.evidenceJson) === key);
    expect(keyed).toHaveLength(1);
    expect(keyed[0]?.title).toBe("Rewrite the heating page title");
    const audits = await getDb().select().from(clientAuditLog).where(eq(clientAuditLog.entityId, created.id));
    expect(audits).toHaveLength(1);
  });

  it("does not dedupe the same key for a different identity on the same client", async () => {
    const key = "retry-key-identity0001";
    const otherName = `b${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const otherIdentityId = await createIdentity(otherName, ["cerevex.recs.submit"], clientId);
    const first = await postSubmit(bodyFor(submitIdentityId, clientId, { idempotencyKey: key }));
    const second = await postSubmit(
      bodyFor(otherIdentityId, clientId, {
        idempotencyKey: key,
        title: "Second identity files its own rec",
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const created = (await json(first)).recommendation as { id: string; outcome: string };
    const otherBody = await json(second);
    const other = otherBody.recommendation as { id: string; outcome: string; source: string };
    expect(created.outcome).toBe("created");
    expect(other).toMatchObject({
      outcome: "created",
      status: "proposed",
      approvalStatus: "PENDING_APPROVAL",
      source: `agent:${otherName}`,
    });
    expect(other.id).not.toBe(created.id);
    expect(JSON.stringify(otherBody)).not.toContain(created.id);
    const rows = await keyedRows(clientId, key);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual([created.id, other.id].sort());
    expect(rows.map((row) => mcpIdentity(row.evidenceJson)).sort()).toEqual([otherIdentityId, submitIdentityId].sort());
  });

  it("does not dedupe the same key for the same identity on a different client", async () => {
    const key = "retry-key-client000001";
    const first = await postSubmit(bodyFor(submitIdentityId, clientId, { idempotencyKey: key }));
    const second = await postSubmit(bodyFor(submitIdentityId, secondClientId, { idempotencyKey: key }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const created = (await json(first)).recommendation as { id: string; outcome: string };
    const otherBody = await json(second);
    const other = otherBody.recommendation as { id: string; outcome: string };
    expect(created.outcome).toBe("created");
    expect(other).toMatchObject({ outcome: "created", status: "proposed", approvalStatus: "PENDING_APPROVAL" });
    expect(other.id).not.toBe(created.id);
    expect(JSON.stringify(otherBody)).not.toContain(created.id);
    expect(await keyedRows(clientId, key)).toEqual([expect.objectContaining({ id: created.id })]);
    expect(await keyedRows(secondClientId, key)).toEqual([expect.objectContaining({ id: other.id })]);
  });

  it("stores one recommendation when the same key is submitted concurrently", async () => {
    const key = "retry-key-concurrent01";
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => postSubmit(bodyFor(submitIdentityId, clientId, { idempotencyKey: key }))),
    );
    expect(responses.map((res) => res.status)).toEqual(Array.from({ length: 10 }, () => 200));
    const submitted = await Promise.all(
      responses.map(async (res) => (await json(res)).recommendation as { id: string; outcome: string }),
    );
    expect(new Set(submitted.map((row) => row.id)).size).toBe(1);
    expect(submitted.filter((row) => row.outcome === "created")).toHaveLength(1);
    expect(submitted.filter((row) => row.outcome === "duplicate")).toHaveLength(9);
    const rows = await keyedRows(clientId, key);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(submitted[0]?.id);
  });

  it("does not let another identity reuse the key as the same rec", async () => {
    const res = await postSubmit(bodyFor(peerIdentityId, ungrantedClientId));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.recommendation).toMatchObject({ outcome: "created", status: "proposed", approvalStatus: "PENDING_APPROVAL" });
    const rows = await getDb().select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.clientId, ungrantedClientId));
    expect(rows).toHaveLength(1);
  });

  it("does not accept an identity from another workspace", async () => {
    const res = await postSubmit(bodyFor(foreignIdentityId, clientId));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(JSON.stringify({ ok: false }));
  });

  it("has no approve or apply import on the submit path", () => {
    const files = ["apps/ads/api/src/mcp-submit.ts", "apps/ads/shared/src/mcp-recommendations.ts"];
    const combined = files.map((file) => readFileSync(`${repoRoot}${file}`, "utf8")).join("\n");
    expect(combined).not.toMatch(/from\s+["'][^"']*\/apply["']/);
    expect(combined).not.toMatch(/createApplyJob/);
    expect(combined).not.toMatch(/kind:\s*"approved"/);
    expect(combined).not.toMatch(/kind:\s*"applied"/);
    expect(combined).toContain("proposedMutations: []");
  });
});

function settingsWith(settings: unknown, tripped: boolean): Record<string, unknown> {
  const base =
    settings !== null && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) }
      : {};
  base.mcpConnectorKillSwitch = tripped;
  return base;
}

async function recommendationIds(clientId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(eq(recommendations.clientId, clientId));
  return rows.map((row) => row.id);
}

function mcpRecord(evidence: unknown): Record<string, unknown> | null {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const mcp = (evidence as Record<string, unknown>).mcp;
  if (mcp === null || typeof mcp !== "object" || Array.isArray(mcp)) return null;
  return mcp as Record<string, unknown>;
}

function mcpKey(evidence: unknown): string | null {
  const key = mcpRecord(evidence)?.idempotencyKey;
  return typeof key === "string" ? key : null;
}

function mcpIdentity(evidence: unknown): string | null {
  const identityId = mcpRecord(evidence)?.identityId;
  return typeof identityId === "string" ? identityId : null;
}

async function keyedRows(clientId: string, key: string) {
  const rows = await getDb()
    .select({ id: recommendations.id, evidenceJson: recommendations.evidenceJson })
    .from(recommendations)
    .where(eq(recommendations.clientId, clientId));
  return rows.filter((row) => mcpKey(row.evidenceJson) === key);
}
