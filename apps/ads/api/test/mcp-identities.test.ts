import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clients, mcpIdentities, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { MCP_DISPLAY_NAME_MESSAGE } from "@cerevex/contracts";
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
        body: JSON.stringify({ displayName: name, scopes: ["cerevex.read"], clientIds: [] }),
      });
      expect(res.status).toBe(403);
    }
    const mcpCaller = await app.request("/mcp/identities", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ displayName: name, scopes: ["cerevex.read"], clientIds: [] }),
    });
    expect(mcpCaller.status).toBe(401);
    const missing = await app.request("/mcp/identities");
    expect(missing.status).toBe(401);

    const badScope = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ displayName: name, scopes: ["cerevex.apply"], clientIds: [] }),
    });
    expect(badScope.status).toBe(400);

    const otherTenant = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ displayName: name, scopes: ["cerevex.read"], clientIds: [otherClientId] }),
    });
    expect(otherTenant.status).toBe(400);

    const created = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({
        displayName: name,
        scopes: ["cerevex.recs.submit", "cerevex.read"],
        clientIds: [clientId],
      }),
    });
    expect(created.status).toBe(200);
    const body = await json(created);
    const token = String(body.token ?? "");
    expect(token.startsWith("cxm_")).toBe(true);
    const identity = body.identity as { id: string; name: string; displayName: string; scopes: string[]; clientIds: string[] };
    expect(identity.name).toBe(name);
    expect(identity.displayName).toBe(name);
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
      body: JSON.stringify({ displayName: name, scopes: ["cerevex.read"], clientIds: [] }),
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
        displayName: "raw-token-rejected",
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

      const before = await getDb()
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "mcp.connector.kill_switch")));
      const cleared = await app.request("/mcp/connector", {
        method: "PUT",
        headers: owner(true),
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(await json(cleared)).toEqual({ killSwitch: false });
      const written = await getDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "mcp.connector.kill_switch")));
      const added = written.filter((row) => !before.some((prior) => prior.id === row.id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        actorType: "user",
        entityType: "mcp_connector",
        entityId: null,
        payloadJson: { killSwitch: false },
      });
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

  it("does not verify a token that belongs to another workspace", async () => {
    const token = `cxm_${"d".repeat(43)}`;
    const [row] = await getDb()
      .insert(mcpIdentities)
      .values({
        workspaceId: otherWorkspaceId,
        name: "foreign-agent",
        displayName: "foreign-agent",
        tokenHash: hashMcpToken(token),
        scopes: ["cerevex.read"],
      })
      .returning({ id: mcpIdentities.id });
    try {
      const verified = await app.request("/internal/mcp/verify", {
        method: "POST",
        headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
        body: JSON.stringify({ tokenHash: hashMcpToken(token) }),
      });
      expect(await json(verified)).toEqual({ ok: false });
    } finally {
      if (row) await getDb().delete(mcpIdentities).where(eq(mcpIdentities.id, row.id));
    }
  });

  it("refuses a grant of a client from another workspace", async () => {
    const name = `grant-${Date.now().toString(36)}`.slice(0, 40);
    const created = await app.request("/mcp/identities", {
      method: "POST",
      headers: owner(true),
      body: JSON.stringify({ displayName: name, scopes: ["cerevex.read"], clientIds: [clientId] }),
    });
    expect(created.status).toBe(200);
    const identity = (await json(created)).identity as { id: string };
    const granted = await app.request(`/mcp/identities/${identity.id}/grants`, {
      method: "PUT",
      headers: owner(true),
      body: JSON.stringify({ clientIds: [otherClientId] }),
    });
    expect(granted.status).toBe(400);
    const listed = await app.request("/mcp/identities", { headers: owner() });
    const body = (await json(listed)) as { identities: Array<{ id: string; clientIds: string[] }> };
    expect(body.identities.find((row) => row.id === identity.id)?.clientIds).toEqual([clientId]);
    await getDb().delete(mcpIdentities).where(eq(mcpIdentities.id, identity.id));
  });

  it("accepts a free-form display name and keeps the slug, token, and scopes stable", async () => {
    async function post(displayName: unknown, extra: Record<string, unknown> = {}) {
      return app.request("/mcp/identities", {
        method: "POST",
        headers: owner(true),
        body: JSON.stringify({ displayName, scopes: ["cerevex.read"], clientIds: [], ...extra }),
      });
    }

    const rejected = [
      "",
      "   ",
      "A".repeat(65),
      "é".repeat(65),
      "Grok\nBot",
      "Grok\tBot",
      "Grok\u0000Bot",
      "Grok\u007fBot",
      "Grok\u0085Bot",
      "Grok\u009fBot",
      "Grok\u200B_Bot",
      "\u202Etob",
    ];
    for (const displayName of rejected) {
      const res = await post(displayName);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: MCP_DISPLAY_NAME_MESSAGE });
    }
    const forcedSlug = await post("Grok_Bot", { name: "picked-slug" });
    expect(forcedSlug.status).toBe(400);

    const slugOf = (base: string) => new RegExp(`^${base}(?:-\\d+)?$`);
    const one = await post("A");
    expect(one.status).toBe(200);
    const oneBody = (await json(one)).identity as { displayName: string; name: string };
    expect(oneBody.displayName).toBe("A");
    expect(oneBody.name).toMatch(slugOf("agent"));

    const max = "B".repeat(64);
    const sixtyFour = await post(max);
    expect(sixtyFour.status).toBe(200);
    const sixtyFourBody = (await json(sixtyFour)).identity as { displayName: string; name: string };
    expect(sixtyFourBody.displayName).toBe(max);
    expect(sixtyFourBody.name).toMatch(/^b+(?:-\d+)?$/);

    for (const [displayName, slug] of [
      ["Agent #1", "agent-1"],
      ["José", "jos"],
      ["O'Brien", "o-brien"],
      ["CQ 😀 bot", "cq-bot"],
      [`CQ${"é".repeat(62)}`, "cq"],
    ] as const) {
      const res = await post(displayName);
      expect(res.status, displayName).toBe(200);
      const row = (await json(res)).identity as { displayName: string; name: string };
      expect(row.displayName).toBe(displayName);
      expect(row.name).toMatch(slugOf(slug));
    }

    const stamp = `q${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    const before = await app.request("/mcp/connector", { headers: owner() });
    const killSwitch = (await json(before)).killSwitch;
    const created = await post(`  ${stamp}_Bot  `);
    expect(created.status).toBe(200);
    const body = await json(created);
    const token = String(body.token ?? "");
    const identity = body.identity as { id: string; name: string; displayName: string; scopes: string[] };
    expect(identity.displayName).toBe(`${stamp}_Bot`);
    expect(identity.name).toBe(`${stamp}-bot`);
    expect(identity.scopes).toEqual(["cerevex.read"]);
    expect(token.startsWith("cxm_")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    const after = await app.request("/mcp/connector", { headers: owner() });
    expect((await json(after)).killSwitch).toBe(killSwitch);

    const stored = await getDb().select().from(mcpIdentities).where(eq(mcpIdentities.id, identity.id));
    expect(stored[0]?.name).toBe(`${stamp}-bot`);
    expect(stored[0]?.displayName).toBe(`${stamp}_Bot`);
    expect(stored[0]?.tokenHash).toBe(hashMcpToken(token));
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored[0])).not.toContain(token);

    const verified = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken(token) }),
    });
    expect(await json(verified)).toEqual({
      ok: true,
      identity: { id: identity.id, name: `${stamp}-bot`, scopes: ["cerevex.read"] },
    });
    const wrong = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken("cxm_not-the-token") }),
    });
    expect(await json(wrong)).toEqual({ ok: false });

    for (const displayName of [`${stamp}_bot`, `${stamp.toUpperCase()}_BOT`, ` ${stamp}_Bot `]) {
      const duplicate = await post(displayName);
      expect(duplicate.status).toBe(409);
    }
    const spaced = await post(`${stamp} Bot`);
    expect(spaced.status).toBe(200);
    const spacedBody = await json(spaced);
    expect(spacedBody.identity).toMatchObject({ displayName: `${stamp} Bot`, name: `${stamp}-bot-2` });
    const spacedToken = String(spacedBody.token ?? "");
    expect(hashMcpToken(spacedToken)).not.toBe(hashMcpToken(token));

    const [other] = await getDb()
      .insert(mcpIdentities)
      .values({
        workspaceId: otherWorkspaceId,
        name: `${stamp}-bot`,
        displayName: `${stamp}_Bot`,
        tokenHash: createHash("sha256").update(`other-${stamp}`).digest("hex"),
        scopes: ["cerevex.read"],
      })
      .returning({ id: mcpIdentities.id });
    expect(other?.id).toBeTruthy();
    if (other) await getDb().delete(mcpIdentities).where(eq(mcpIdentities.id, other.id));

    const legacyToken = `cxm_${stamp}${randomBytes(8).toString("hex")}`;
    const legacyName = `leg${stamp}`.slice(0, 40);
    const [legacy] = await getDb()
      .insert(mcpIdentities)
      .values({
        workspaceId,
        name: legacyName,
        displayName: legacyName,
        tokenHash: hashMcpToken(legacyToken),
        scopes: ["cerevex.read", "cerevex.recs.submit"],
      })
      .returning({ id: mcpIdentities.id });
    if (!legacy) throw new Error("legacy identity missing");
    const legacyVerify = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken(legacyToken) }),
    });
    expect(await json(legacyVerify)).toEqual({
      ok: true,
      identity: { id: legacy.id, name: legacyName, scopes: ["cerevex.read", "cerevex.recs.submit"] },
    });
    const listed = await app.request("/mcp/identities", { headers: owner() });
    const list = (await json(listed)) as { identities: Array<{ id: string; name: string; displayName: string }> };
    expect(list.identities.find((row) => row.id === legacy.id)).toMatchObject({
      name: legacyName,
      displayName: legacyName,
    });

    const granted = await app.request(`/mcp/identities/${identity.id}/grants`, {
      method: "PUT",
      headers: owner(true),
      body: JSON.stringify({ clientIds: [clientId] }),
    });
    expect(granted.status).toBe(200);
    expect((await json(granted)).identity).toMatchObject({
      name: `${stamp}-bot`,
      displayName: `${stamp}_Bot`,
      clientIds: [clientId],
    });
    const revoked = await app.request(`/mcp/identities/${identity.id}/revoke`, { method: "POST", headers: owner() });
    expect(revoked.status).toBe(200);
    expect((await json(revoked)).identity).toMatchObject({ name: `${stamp}-bot`, displayName: `${stamp}_Bot` });
    const rename = await app.request(`/mcp/identities/${identity.id}`, {
      method: "PUT",
      headers: owner(true),
      body: JSON.stringify({ displayName: "Renamed Bot" }),
    });
    expect(rename.status).toBe(404);
    const afterWrite = await getDb().select().from(mcpIdentities).where(eq(mcpIdentities.id, identity.id));
    expect(afterWrite[0]?.name).toBe(`${stamp}-bot`);
    expect(afterWrite[0]?.displayName).toBe(`${stamp}_Bot`);
    const still = await app.request("/internal/mcp/verify", {
      method: "POST",
      headers: { "x-cerevex-mcp-key": MCP_KEY, "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: hashMcpToken(token) }),
    });
    expect(await json(still)).toEqual({ ok: false });
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
