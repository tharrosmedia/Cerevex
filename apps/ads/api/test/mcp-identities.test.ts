import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clients, mcpIdentities, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { hashMcpToken } from "../src/mcp-token";
import { assertMcpPrincipalConfigured } from "../src/mcp-principal";
import { app, ensureScopedUser, json, login } from "./helpers";

const INTERNAL_KEY = "identity-internal-key";
const MCP_KEY = "identity-mcp-key";
const HASH = "5891371737a653c4800cad5dfa0846e827562ed4fa4c22ae0c9ffbd509f01be5";

describe("mcp identity admin", () => {
  let ownerToken = "";
  let operatorToken = "";
  let readonlyToken = "";
  let workspaceId = "";
  let otherWorkspaceId = "";
  let clientId = "";
  let otherClientId = "";
  const original = {
    key: process.env.ADS_INTERNAL_KEY,
    mcp: process.env.MCP_SERVICE_KEY,
    workspace: process.env.ADS_INTERNAL_WORKSPACE_ID,
    node: process.env.NODE_ENV,
    signing: process.env.CEREVEX_REQUIRE_SIGNING_SECRETS,
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
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    const scoped = await ensureScopedUser();
    clientId = scoped.gotDuctless.id;
    readonlyToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;

    const email = "mcp.identity.operator@tharrosmedia.com";
    const passwordHash = await hash("mcp-identity-operator", 10);
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ??
      (await db.insert(users).values({ email, name: "MCP identity operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await db.update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await db.insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" }).onConflictDoNothing();
    operatorToken = (await login(email, "mcp-identity-operator")).token;

    const [otherWorkspace] = await db.insert(workspaces).values({ name: `MCP other ${Date.now()}` }).returning();
    if (!otherWorkspace) throw new Error("other workspace missing");
    otherWorkspaceId = otherWorkspace.id;
    const [otherClient] = await db
      .insert(clients)
      .values({ workspaceId: otherWorkspaceId, name: "Other tenant", status: "active" })
      .returning();
    if (!otherClient) throw new Error("other client missing");
    otherClientId = otherClient.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      await db.delete(mcpIdentities).where(eq(mcpIdentities.workspaceId, workspaceId));
    }
    if (otherClientId) await db.delete(clients).where(eq(clients.id, otherClientId));
    if (original.key === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = original.key;
    if (original.mcp === undefined) delete process.env.MCP_SERVICE_KEY;
    else process.env.MCP_SERVICE_KEY = original.mcp;
    if (original.workspace === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = original.workspace;
    if (original.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.node;
    if (original.signing === undefined) delete process.env.CEREVEX_REQUIRE_SIGNING_SECRETS;
    else process.env.CEREVEX_REQUIRE_SIGNING_SECRETS = original.signing;
    await closeDb();
  });

  function owner(jsonBody = false): Record<string, string> {
    return {
      authorization: `Bearer ${ownerToken}`,
      ...(jsonBody ? { "content-type": "application/json" } : {}),
    };
  }

  it("hashes the token the same way the MCP service does", () => {
    expect(hashMcpToken("cxm_example")).toBe(HASH);
    expect(hashMcpToken("cxm_example")).toBe(createHash("sha256").update("cxm_example", "utf8").digest("hex"));
  });

  it("refuses a production boot when the MCP key copies the Brain key or has no workspace", () => {
    process.env.CEREVEX_REQUIRE_SIGNING_SECRETS = "1";
    process.env.MCP_SERVICE_KEY = "same-secret";
    process.env.ADS_INTERNAL_KEY = "same-secret";
    try {
      expect(() => assertMcpPrincipalConfigured()).toThrow(/must not equal/);
      process.env.ADS_INTERNAL_KEY = "different-secret";
      delete process.env.ADS_INTERNAL_WORKSPACE_ID;
      expect(() => assertMcpPrincipalConfigured()).toThrow(/ADS_INTERNAL_WORKSPACE_ID/);
    } finally {
      process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
      process.env.MCP_SERVICE_KEY = MCP_KEY;
      process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
      delete process.env.CEREVEX_REQUIRE_SIGNING_SECRETS;
    }
    expect(() => assertMcpPrincipalConfigured()).not.toThrow();
  });

  it("lets only the owner create, list, grant, and revoke, and shows the token once", async () => {
    const name = `agent-${Date.now().toString(36)}`.slice(0, 40);
    const forbidden: Record<string, string>[] = [
      { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      { authorization: `Bearer ${readonlyToken}`, "content-type": "application/json" },
      { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" },
    ];
    for (const headers of forbidden) {
      const res = await app.request("/mcp/identities", {
        method: "POST",
        headers,
        body: JSON.stringify({ name, scopes: ["cerevex.read"], clientIds: [] }),
      });
      expect(res.status).toBe(403);
    }
    const mcpCaller = await app.request("/mcp/identities", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ name, scopes: ["cerevex.read"], clientIds: [] }),
    });
    expect(mcpCaller.status).toBe(401);
    const missing = await app.request("/mcp/identities");
    expect(missing.status).toBe(401);

    const badScope = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ name, scopes: ["cerevex.apply"], clientIds: [] }),
    });
    expect(badScope.status).toBe(400);

    const otherTenant = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ name, scopes: ["cerevex.read"], clientIds: [otherClientId] }),
    });
    expect(otherTenant.status).toBe(400);

    const created = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({
        name,
        scopes: ["cerevex.recs.submit", "cerevex.read"],
        clientIds: [clientId],
      }),
    });
    expect(created.status).toBe(200);
    const body = await json(created);
    const token = String(body.token ?? "");
    expect(token.startsWith("cxm_")).toBe(true);
    const identity = body.identity as { id: string; scopes: string[]; clientIds: string[] };
    expect(identity.scopes).toEqual(["cerevex.read", "cerevex.recs.submit"]);
    expect(identity.clientIds).toEqual([clientId]);
    expect(JSON.stringify(body)).not.toContain("tokenHash");

    const listed = await app.request("/mcp/identities", { headers: owner() });
    const listText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listText).not.toContain(token);
    expect(listText).not.toContain(hashMcpToken(token));

    const rows = await getDb().select().from(mcpIdentities).where(eq(mcpIdentities.id, identity.id));
    expect(rows[0]?.tokenHash).toBe(hashMcpToken(token));
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(token);

    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "mcp.identity.create")));
    const audit = audits.find((row) => row.entityId === identity.id);
    expect(audit?.actorType).toBe("user");
    expect(audit?.actorId).toBeTruthy();
    expect(JSON.stringify(audit?.payloadJson)).not.toContain(token);
    expect(JSON.stringify(audit?.payloadJson)).not.toContain(hashMcpToken(token));

    const duplicate = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ name, scopes: ["cerevex.read"], clientIds: [] }),
    });
    expect(duplicate.status).toBe(409);

    const verify = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken(token) }),
    });
    expect(await json(verify)).toEqual({
      ok: true,
      identity: { id: identity.id, name, scopes: ["cerevex.read", "cerevex.recs.submit"] },
    });
    const brainVerify = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken(token) }),
    });
    expect(brainVerify.status).toBe(401);
    expect(await brainVerify.text()).not.toContain(token);

    const granted = await app.request(`/mcp/identities/${identity.id}/grants`, {
      method: "PUT",
      headers: owner(true),
      body: JSON.stringify({ clientIds: [] }),
    });
    expect((await json(granted)).identity).toMatchObject({ clientIds: [] });
    const operatorGrant = await app.request(`/mcp/identities/${identity.id}/grants`, {
      method: "PUT",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientIds: [clientId] }),
    });
    expect(operatorGrant.status).toBe(403);

    const revoked = await app.request(`/mcp/identities/${identity.id}/revoke`, { method: "POST", headers: owner() });
    expect(revoked.status).toBe(200);
    expect((await json(revoked)).identity).toMatchObject({ revokedAt: expect.any(String) });
    const again = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken(token) }),
    });
    expect(await json(again)).toEqual({ ok: false });
    const second = await app.request(`/mcp/identities/${identity.id}/revoke`, { method: "POST", headers: owner() });
    expect(second.status).toBe(200);
    const revokeAudits = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "mcp.identity.revoke"), eq(auditLog.entityId, identity.id)));
    expect(revokeAudits).toHaveLength(1);

    await expect(
      getDb().insert(mcpIdentities).values({
        workspaceId,
        name: "raw-token-rejected",
        tokenHash: token,
        scopes: ["cerevex.read"],
      }),
    ).rejects.toThrow();
    const storedRaw = await getDb().select().from(mcpIdentities).where(eq(mcpIdentities.name, "raw-token-rejected"));
    expect(storedRaw).toHaveLength(0);
  });

  it("lets only the owner write the connector kill switch", async () => {
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    const previous = workspace?.settingsJson;
    const previousApply = workspace?.applyKillSwitch;
    try {
      const operator = await app.request("/mcp/connector", {
        method: "PUT",
        headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(operator.status).toBe(403);
      const service = await app.request("/mcp/connector", {
        method: "PUT",
        headers: { "x-cerevex-internal-key": INTERNAL_KEY, "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(service.status).toBe(403);
      const mcp = await app.request("/mcp/connector", {
        method: "PUT",
        headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(mcp.status).toBe(401);
      const bogus = await app.request("/mcp/connector", {
        method: "PUT",
        headers: owner(true),
        body: JSON.stringify({ killSwitch: "false" }),
      });
      expect(bogus.status).toBe(400);

      const cleared = await app.request("/mcp/connector", {
        method: "PUT",
        headers: owner(true),
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(await json(cleared)).toEqual({ killSwitch: false });
      const read = await app.request("/internal/mcp/connector", { headers: { "x-cerevex-mcp-key": MCP_KEY } });
      expect(await json(read)).toEqual({ killSwitch: false });
      const stored = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
      expect(stored?.applyKillSwitch).toBe(previousApply);
      const tripped = await app.request("/mcp/connector", {
        method: "PUT",
        headers: owner(true),
        body: JSON.stringify({ killSwitch: true }),
      });
      expect(await json(tripped)).toEqual({ killSwitch: true });
      const audits = await getDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "mcp.connector.kill_switch")));
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits.at(-1)?.payloadJson)).not.toContain(MCP_KEY);
    } finally {
      if (workspaceId) {
        await getDb()
          .update(workspaces)
          .set({ settingsJson: previous ?? {}, applyKillSwitch: previousApply ?? true })
          .where(eq(workspaces.id, workspaceId));
      }
    }
  });

  it("refuses the MCP routes when the MCP key is a copy of the Brain key", async () => {
    process.env.MCP_SERVICE_KEY = INTERNAL_KEY;
    try {
      const res = await app.request("/internal/mcp/connector", {
        headers: { "x-cerevex-mcp-key": INTERNAL_KEY },
      });
      expect(res.status).toBe(401);
      const asBrain = await app.request("/clients", { headers: { "x-cerevex-internal-key": INTERNAL_KEY } });
      expect(asBrain.status).not.toBe(401);
    } finally {
      process.env.MCP_SERVICE_KEY = MCP_KEY;
    }
  });
});
