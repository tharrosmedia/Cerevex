import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clientAuditLog, workspaces } from "@tharros/ads-shared/schema";
import { connectorKillSwitchTripped, MCP_CONNECTOR_KILL_SWITCH_KEY } from "../src/mcp-connector";
import { app, json, login } from "./helpers";

const INTERNAL_KEY = "test-internal-service-key";
const MCP_KEY = "test-mcp-service-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;
const ORIGINAL_MCP_KEY = process.env.MCP_SERVICE_KEY;
const ORIGINAL_WORKSPACE = process.env.ADS_INTERNAL_WORKSPACE_ID;

const auditBody = {
  requestId: "22222222-2222-4222-8222-222222222222",
  result: "denied",
  httpStatus: 401,
  protocolVersion: "2026-07-28",
  method: "tools/list",
  tool: null,
  clientName: "ExampleClient",
  clientVersion: "1.0.0",
  latencyMs: 4,
  reason: "unauthenticated",
  identityId: null,
  identityName: null,
  authType: "unauthenticated",
  count: 1,
};

describe("mcp connector façade", () => {
  let ownerToken = "";
  let workspaceId = "";
  let originalSettings: unknown;

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.MCP_SERVICE_KEY = MCP_KEY;
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    originalSettings = workspace.settingsJson;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
  });

  afterAll(async () => {
    if (workspaceId) {
      await getDb()
        .update(workspaces)
        .set({ settingsJson: originalSettings ?? {}, applyKillSwitch: true })
        .where(eq(workspaces.id, workspaceId));
    }
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MCP_KEY === undefined) delete process.env.MCP_SERVICE_KEY;
    else process.env.MCP_SERVICE_KEY = ORIGINAL_MCP_KEY;
    if (ORIGINAL_WORKSPACE === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = ORIGINAL_WORKSPACE;
    await closeDb();
  });

  function mcpHeaders(jsonBody = false): Record<string, string> {
    return {
      "x-cerevex-mcp-key": MCP_KEY,
      ...(jsonBody ? { "content-type": "application/json" } : {}),
    };
  }

  async function setSettings(settingsJson: unknown) {
    await getDb().update(workspaces).set({ settingsJson }).where(eq(workspaces.id, workspaceId));
  }

  it("trips unless the workspace flag is boolean false, and ignores the ads apply switch", () => {
    expect(connectorKillSwitchTripped(undefined)).toBe(true);
    expect(connectorKillSwitchTripped({})).toBe(true);
    expect(connectorKillSwitchTripped({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: true })).toBe(true);
    expect(connectorKillSwitchTripped({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: "false" })).toBe(true);
    expect(connectorKillSwitchTripped({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: 0 })).toBe(true);
    expect(connectorKillSwitchTripped({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: null })).toBe(true);
    expect(connectorKillSwitchTripped([])).toBe(true);
    expect(connectorKillSwitchTripped({ applyKillSwitch: false })).toBe(true);
    expect(connectorKillSwitchTripped({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: false })).toBe(false);
  });

  it("requires the MCP service key and does not accept the Brain service key or a query string", async () => {
    const missing = await app.request("/internal/mcp/connector");
    expect(missing.status).toBe(401);
    const brain = await app.request("/internal/mcp/connector", {
      headers: { "x-cerevex-internal-key": INTERNAL_KEY },
    });
    expect(brain.status).toBe(401);
    const wrong = await app.request("/internal/mcp/connector", {
      headers: { "x-cerevex-mcp-key": "wrong-mcp-key" },
    });
    expect(wrong.status).toBe(401);
    const query = await app.request(`/internal/mcp/connector?x-cerevex-mcp-key=${MCP_KEY}`);
    expect(query.status).toBe(401);
    const owner = await app.request("/internal/mcp/connector", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(owner.status).toBe(401);
    const clients = await app.request("/clients", { headers: mcpHeaders() });
    expect(clients.status).toBe(401);
  });

  it("reports the workspace flag and not the ads apply column", async () => {
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    await setSettings({ ...(originalSettings as Record<string, unknown>) });
    const tripped = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
    expect(tripped.status).toBe(200);
    expect(await json(tripped)).toEqual({ killSwitch: true });

    await setSettings({
      ...(originalSettings as Record<string, unknown>),
      [MCP_CONNECTOR_KILL_SWITCH_KEY]: "false",
    });
    const stillTripped = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
    expect(await json(stillTripped)).toEqual({ killSwitch: true });

    await setSettings({
      ...(originalSettings as Record<string, unknown>),
      [MCP_CONNECTOR_KILL_SWITCH_KEY]: false,
    });
    const clear = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
    expect(await json(clear)).toEqual({ killSwitch: false });
    await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
  });

  it("appends a workspace security audit and refuses extra fields", async () => {
    const clientBefore = await getDb()
      .select({ id: clientAuditLog.id })
      .from(clientAuditLog)
      .where(eq(clientAuditLog.workspaceId, workspaceId));
    const posted = await app.request("/internal/mcp/security-audit", {
      method: "POST",
      headers: mcpHeaders(true),
      body: JSON.stringify(auditBody),
    });
    expect(posted.status).toBe(200);
    expect(await json(posted)).toEqual({ ok: true });

    const rows = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "mcp.call")));
    const row = rows.find((item) => (item.payloadJson as { requestId?: string }).requestId === auditBody.requestId);
    expect(row?.actorType).toBe("mcp");
    expect(row?.actorId).toBeNull();
    expect(row?.entityType).toBe("mcp_request");
    expect(row?.payloadJson).toEqual(auditBody);

    const clientAfter = await getDb()
      .select({ id: clientAuditLog.id })
      .from(clientAuditLog)
      .where(eq(clientAuditLog.workspaceId, workspaceId));
    expect(clientAfter).toHaveLength(clientBefore.length);

    const owner = await app.request("/internal/mcp/security-audit", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify(auditBody),
    });
    expect(owner.status).toBe(401);

    const planted = "do-not-store-this-token";
    const extra = await app.request("/internal/mcp/security-audit", {
      method: "POST",
      headers: mcpHeaders(true),
      body: JSON.stringify({ ...auditBody, authorization: planted, requestId: "33333333-3333-4333-8333-333333333333" }),
    });
    expect(extra.status).toBe(400);
    expect(await extra.text()).not.toContain(planted);
    const leaked = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "mcp.call"));
    expect(JSON.stringify(leaked)).not.toContain(planted);
  });
});
