import { describe, expect, it } from "vitest";
import { asRemoteKillSwitch, connectorKilled, envForcesOff, remoteFromApiBody } from "../src/kill-switch";
import { readJson, request2026, testApp } from "./helpers";

describe("connector kill switch", () => {
  const remotes = ["clear", "tripped", "unreachable", "open", "", null, false, true, undefined] as const;

  for (const remote of remotes) {
    it(`forces off for any non-empty env when the remote state is ${String(remote)}`, () => {
      for (const envValue of ["on", "ON", " on ", "off", "OFF", "false", "0", "no", "disabled", "enabled", "yes"]) {
        expect(envForcesOff(envValue)).toBe(true);
        expect(connectorKilled(envValue, remote)).toBe(true);
      }
    });
  }

  it("treats unset and blank env as not an emergency brake", () => {
    expect(envForcesOff(undefined)).toBe(false);
    expect(envForcesOff("")).toBe(false);
    expect(envForcesOff("   ")).toBe(false);
  });

  it("opens only when the env is blank and the remote state is exactly clear", () => {
    for (const envValue of [undefined, "", "   "]) {
      expect(connectorKilled(envValue, "clear")).toBe(false);
      expect(connectorKilled(envValue, "tripped")).toBe(true);
      expect(connectorKilled(envValue, "unreachable")).toBe(true);
      expect(connectorKilled(envValue, "open")).toBe(true);
      expect(connectorKilled(envValue, undefined)).toBe(true);
    }
    expect(asRemoteKillSwitch("clear")).toBe("clear");
    expect(asRemoteKillSwitch("nope")).toBe("unreachable");
  });

  it("reads only a boolean killSwitch and ignores the ads apply switch", () => {
    expect(remoteFromApiBody({ killSwitch: true })).toBe("tripped");
    expect(remoteFromApiBody({ killSwitch: false })).toBe("clear");
    expect(remoteFromApiBody({ killSwitch: "false" })).toBe("unreachable");
    expect(remoteFromApiBody({ killSwitch: 0 })).toBe("unreachable");
    expect(remoteFromApiBody({ killSwitch: null })).toBe("unreachable");
    expect(remoteFromApiBody({ applyKillSwitch: false })).toBe("unreachable");
    expect(remoteFromApiBody({ killSwitch: false, applyKillSwitch: true })).toBe("clear");
    expect(remoteFromApiBody(null)).toBe("unreachable");
    expect(remoteFromApiBody([])).toBe("unreachable");
    expect(remoteFromApiBody("false")).toBe("unreachable");
  });
});

describe("POST /mcp kill switch", () => {
  it("returns 403 and skips the API when the env brake is set, including the value off", async () => {
    for (const killSwitchEnv of ["on", "off", "false", "0", " ON "]) {
      const { app, guard } = testApp({ remote: "clear", killSwitchEnv });
      const res = await app.request("/mcp", request2026({ authorization: "Bearer token" }));
      expect(res.status, killSwitchEnv).toBe(403);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(await readJson(res)).toMatchObject({ id: null, error: { message: "Connector is off" } });
      expect(guard.calls.kill).toBe(0);
      expect(guard.calls.audits[0]).toMatchObject({ reason: "kill_switch", result: "denied", httpStatus: 403 });
    }
  });

  it("returns 403 when the workspace flag is tripped or the API cannot be read", async () => {
    for (const remote of ["tripped", "unreachable", "open"]) {
      const { app, guard } = testApp({ remote, killSwitchEnv: undefined });
      const res = await app.request("/mcp", request2026());
      expect(res.status, remote).toBe(403);
      expect(await res.text()).toContain("Connector is off");
      expect(guard.calls.kill).toBe(1);
    }
  });

  it("returns 403 when the kill switch read throws", async () => {
    const { app } = testApp({
      guards: {
        async readKillSwitch() {
          throw new Error("ads api down");
        },
        async writeSecurityAudit() {},
        async verifyToken() {
          return null;
        },
        async readGranted() {
          return { ok: false, status: 404 };
        },
      },
    });
    const res = await app.request("/mcp", request2026());
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("ads api down");
  });

  it("reaches 401 only after the workspace flag reports clear", async () => {
    const { app, guard } = testApp({ remote: "clear", killSwitchEnv: "" });
    const res = await app.request("/mcp", request2026());
    expect(res.status).toBe(401);
    expect(guard.calls.kill).toBe(1);
    expect(guard.calls.audits[0]).toMatchObject({ reason: "unauthenticated", httpStatus: 401 });
  });

  it("takes effect on the next call", async () => {
    let remote = "clear";
    const { app } = testApp({
      guards: {
        async readKillSwitch() {
          return remote as "clear";
        },
        async writeSecurityAudit() {},
        async verifyToken() {
          return null;
        },
        async readGranted() {
          return { ok: false, status: 404 };
        },
      },
    });
    expect((await app.request("/mcp", request2026())).status).toBe(401);
    remote = "tripped";
    expect((await app.request("/mcp", request2026())).status).toBe(403);
    remote = "clear";
    expect((await app.request("/mcp", request2026())).status).toBe(401);
  });

  it("cannot be cleared by a header or a query param", async () => {
    const { app } = testApp({ remote: "tripped" });
    const header = await app.request(
      "/mcp",
      request2026({ extraHeaders: { "x-mcp-kill-switch": "off", "mcp-connector-kill-switch": "off" } }),
    );
    expect(header.status).toBe(403);
    const query = await app.request("/mcp?killSwitch=off&MCP_CONNECTOR_KILL_SWITCH=off", request2026());
    expect(query.status).toBe(403);
  });

  it("answers malformed calls with 403 while tripped, and 400 once the switch is clear", async () => {
    const tripped = await testApp({ remote: "tripped" }).app.request("/mcp", {
      method: "POST",
      headers: { origin: "https://agents.cerevex.test", "content-type": "text/plain" },
      body: "not-json",
    });
    expect(tripped.status).toBe(403);

    const cleared = await testApp({ remote: "clear" }).app.request("/mcp", {
      method: "GET",
      headers: { origin: "https://agents.cerevex.test" },
    });
    expect(cleared.status).toBe(405);
    expect(cleared.headers.get("allow")).toBe("POST");
  });

  it("prefers an origin rejection over the kill switch message", async () => {
    const { app, guard } = testApp({ remote: "tripped", killSwitchEnv: "on" });
    const res = await app.request("/mcp", request2026({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not allowed");
    expect(guard.calls.kill).toBe(0);
  });

  it("leaves /health up while the connector is off", async () => {
    const { app, guard } = testApp({ remote: "tripped", killSwitchEnv: "on" });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "cerevex-mcp" });
    expect(guard.calls.kill).toBe(0);
    expect(guard.calls.audits).toHaveLength(0);
  });
});
