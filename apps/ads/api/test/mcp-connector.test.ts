import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clientAuditLog, workspaces } from "@tharros/ads-shared/schema";
import {
  connectorEffectivelyOff,
  connectorEnvValue,
  connectorKillSwitchTripped,
  connectorOwnerView,
  connectorServiceView,
  envForcesConnectorOff,
  MCP_CONNECTOR_KILL_SWITCH_ENV,
  MCP_CONNECTOR_KILL_SWITCH_KEY,
} from "../src/mcp-connector";
import { app, ensureScopedUser, json, login } from "./helpers";

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
  let readonlyToken = "";
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
    await ensureScopedUser();
    readonlyToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;
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

  it("treats any non-empty env as a hard off, and leaves a blank env to the flag", () => {
    for (const envValue of ["on", "ON", " on ", "off", "false", "0", "no"]) {
      expect(envForcesConnectorOff(envValue)).toBe(true);
      expect(connectorEffectivelyOff({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: false }, envValue)).toBe(true);
      expect(connectorEffectivelyOff({}, envValue)).toBe(true);
    }
    for (const envValue of [undefined, "", "   "]) {
      expect(envForcesConnectorOff(envValue)).toBe(false);
      expect(connectorEffectivelyOff({}, envValue)).toBe(true);
      expect(connectorEffectivelyOff({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: false }, envValue)).toBe(false);
      expect(connectorEffectivelyOff({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: true }, envValue)).toBe(true);
    }
    expect(connectorOwnerView({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: false }, {})).toEqual({
      killSwitch: false,
      envForcedOff: false,
    });
    expect(connectorOwnerView({}, { [MCP_CONNECTOR_KILL_SWITCH_ENV]: "off" })).toEqual({
      killSwitch: true,
      envForcedOff: true,
    });
    expect(connectorServiceView({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: false }, { [MCP_CONNECTOR_KILL_SWITCH_ENV]: "0" })).toEqual({
      killSwitch: true,
    });
    expect(connectorServiceView({ [MCP_CONNECTOR_KILL_SWITCH_KEY]: false }, {})).toEqual({ killSwitch: false });
    expect(connectorEnvValue({})).toBeUndefined();
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

  it("lets only an owner change the switch, and the env override wins over a saved on", async () => {
    const previousEnv = process.env.MCP_CONNECTOR_KILL_SWITCH;
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    const previousApply = workspace?.applyKillSwitch;
    delete process.env.MCP_CONNECTOR_KILL_SWITCH;
    try {
      await setSettings({ vertical: "hvac" });
      const defaults = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
      expect(await json(defaults)).toEqual({ killSwitch: true });
      const ownerDefault = await app.request("/mcp/connector", { headers: { authorization: `Bearer ${ownerToken}` } });
      expect(await json(ownerDefault)).toEqual({ killSwitch: true, envForcedOff: false });

      const readerGet = await app.request("/mcp/connector", {
        headers: { authorization: `Bearer ${readonlyToken}` },
      });
      expect(readerGet.status).toBe(403);
      const reader = await app.request("/mcp/connector", {
        method: "PUT",
        headers: { authorization: `Bearer ${readonlyToken}`, "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(reader.status).toBe(403);
      const untouched = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
      expect(untouched?.settingsJson).toEqual({ vertical: "hvac" });
      expect(untouched?.applyKillSwitch).toBe(previousApply);

      const enabled = await app.request("/mcp/connector", {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: false }),
      });
      expect(await json(enabled)).toEqual({ killSwitch: false, envForcedOff: false });
      const clear = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
      expect(await json(clear)).toEqual({ killSwitch: false });
      const storedOn = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
      expect((storedOn?.settingsJson as { vertical?: string; mcpConnectorKillSwitch?: boolean }).vertical).toBe("hvac");
      expect((storedOn?.settingsJson as { mcpConnectorKillSwitch?: boolean }).mcpConnectorKillSwitch).toBe(false);

      for (const envValue of ["on", "off", "false", "0"]) {
        process.env.MCP_CONNECTOR_KILL_SWITCH = envValue;
        const forced = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
        expect(await json(forced), envValue).toEqual({ killSwitch: true });
        const ownerView = await app.request("/mcp/connector", { headers: { authorization: `Bearer ${ownerToken}` } });
        expect(await json(ownerView), envValue).toEqual({ killSwitch: false, envForcedOff: true });
      }

      process.env.MCP_CONNECTOR_KILL_SWITCH = "   ";
      const blank = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
      expect(await json(blank)).toEqual({ killSwitch: false });

      delete process.env.MCP_CONNECTOR_KILL_SWITCH;
      const disabled = await app.request("/mcp/connector", {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: true }),
      });
      expect(await json(disabled)).toEqual({ killSwitch: true, envForcedOff: false });
      const tripped = await app.request("/internal/mcp/connector", { headers: mcpHeaders() });
      expect(await json(tripped)).toEqual({ killSwitch: true });
    } finally {
      if (previousEnv === undefined) delete process.env.MCP_CONNECTOR_KILL_SWITCH;
      else process.env.MCP_CONNECTOR_KILL_SWITCH = previousEnv;
      if (workspaceId) {
        await getDb()
          .update(workspaces)
          .set({ settingsJson: originalSettings ?? {}, applyKillSwitch: previousApply ?? true })
          .where(eq(workspaces.id, workspaceId));
      }
    }
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
