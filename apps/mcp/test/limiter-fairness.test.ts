import { describe, expect, it } from "vitest";
import { DENIED_IP_LIMIT, DENIED_IP_WINDOW_MS } from "../src/app";
import type { GuardClient } from "../src/guards";
import { ALLOWED_ORIGIN, request2026, testApp } from "./helpers";

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "example-agent",
  scopes: ["cerevex.read"] as const,
};

function token(mark: string): string {
  return `cxm_${mark}${"a".repeat(42)}`;
}

function get(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, ip: string) {
  return Promise.resolve(
    app.request("/mcp", {
      method: "GET",
      headers: { origin: ALLOWED_ORIGIN, "x-real-ip": ip },
    }),
  );
}

function authed(ip: string, bearer = token("v")) {
  return request2026({ authorization: `Bearer ${bearer}`, extraHeaders: { "x-real-ip": ip } });
}

function gatedKillSwitch() {
  let entered = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const guards: GuardClient = {
    async readKillSwitch() {
      entered += 1;
      await gate;
      return "clear";
    },
    async writeSecurityAudit() {},
    async verifyToken() {
      return null;
    },
  };
  return { guards, entered: () => entered, release: () => release() };
}

describe("limiter fairness", () => {
  it("records an address only when its denial take succeeds", async () => {
    let now = 5_000;
    const { app } = testApp({
      deniedPerIp: 10,
      deniedMaxIps: 2,
      deniedWindowMs: 60_000,
      globalDenialCapacity: 1,
      globalDenialRefillPerSecond: 1,
      now: () => now,
    });
    expect((await get(app, "203.0.113.1")).status).toBe(405);
    expect((await get(app, "203.0.113.2")).status).toBe(429);
    now += 1_000;
    expect((await get(app, "203.0.113.3")).status).toBe(405);
  });

  it("records an invalid token only when its denial take succeeds", async () => {
    let lookups = 0;
    const { app } = testApp({
      deniedPerIp: 10,
      deniedMaxIps: 2,
      globalDenialCapacity: 1,
      globalDenialRefillPerSecond: 0,
      globalBearerCapacity: 5,
      globalBearerRefillPerSecond: 0,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const bad = token("b");
    const first = await app.request("/mcp", authed("203.0.113.1", bad));
    const second = await app.request("/mcp", authed("203.0.113.2", bad));
    const third = await app.request("/mcp", authed("203.0.113.3", bad));
    expect([first.status, second.status, third.status]).toEqual([401, 401, 401]);
    expect(lookups).toBe(3);
  });

  it("takes the denial token before the kill-switch read, so a burst cannot fill the map", async () => {
    let now = 10_000;
    const gate = gatedKillSwitch();
    const { app } = testApp({
      deniedPerIp: 30,
      deniedMaxIps: 4,
      deniedWindowMs: 60_000,
      globalDenialCapacity: 2,
      globalDenialRefillPerSecond: 1,
      now: () => now,
      guards: gate.guards,
    });
    const burst = Promise.all(
      Array.from({ length: 20 }, (_, index) => get(app, `203.0.113.${index + 1}`)),
    );
    expect(gate.entered()).toBe(2);
    gate.release();
    const responses = await burst;
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 405)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(18);

    now += 1_000;
    const follow = await get(app, "198.51.100.8");
    expect(follow.status).toBe(405);
    expect(follow.headers.get("retry-after")).toBeNull();
  });

  it("takes the bearer token before the kill-switch read, so a burst cannot fill the map", async () => {
    let now = 20_000;
    let lookups = 0;
    const gate = gatedKillSwitch();
    const { app } = testApp({
      deniedPerIp: 30,
      deniedMaxIps: 3,
      deniedWindowMs: 60_000,
      globalDenialCapacity: 2,
      globalDenialRefillPerSecond: 1,
      globalBearerCapacity: 2,
      globalBearerRefillPerSecond: 1,
      now: () => now,
      guards: gate.guards,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const bad = token("b");
    const burst = Promise.all(
      Array.from({ length: 20 }, (_, index) => app.request("/mcp", authed(`198.51.100.${index + 1}`, bad))),
    );
    expect(gate.entered()).toBe(2);
    expect(lookups).toBe(0);
    gate.release();
    const responses = await burst;
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(18);
    expect(lookups).toBe(2);

    now += 1_000;
    const follow = await app.request("/mcp", authed("203.0.113.40", bad));
    expect(follow.status).toBe(401);
    expect(lookups).toBe(3);
  });

  it("serves a valid token after a 3/s GET flood empties the denial bucket", async () => {
    let now = 0;
    const { app } = testApp({
      deniedPerIp: 1_000,
      globalDenialCapacity: 6,
      globalDenialRefillPerSecond: 1,
      globalBearerCapacity: 6,
      globalBearerRefillPerSecond: 1,
      now: () => now,
      authenticator: () => ({ ok: true, identity: IDENTITY }),
    });
    const attacker = "203.0.113.10";
    const statuses: number[] = [];
    for (let second = 0; second < 4; second += 1) {
      if (second > 0) now += 1_000;
      for (let hit = 0; hit < 3; hit += 1) statuses.push((await get(app, attacker)).status);
    }
    expect(statuses.some((status) => status === 429)).toBe(true);
    const valid = await app.request("/mcp", authed(attacker));
    expect(valid.status).toBe(200);
    expect(valid.headers.get("retry-after")).toBeNull();
    expect((await get(app, "203.0.113.11")).status).toBe(429);
  });

  it("serves a valid token from an address flooding GETs at 3/s", async () => {
    let now = 1_000_000;
    const seconds = Math.ceil((DENIED_IP_LIMIT + 1) / 3);
    expect(seconds * 1_000).toBeLessThan(DENIED_IP_WINDOW_MS);
    const { app } = testApp({
      now: () => now,
      authenticator: () => ({ ok: true, identity: IDENTITY }),
    });
    const attacker = "203.0.113.50";
    const statuses: number[] = [];
    for (let second = 0; second < seconds; second += 1) {
      for (let hit = 0; hit < 3; hit += 1) statuses.push((await get(app, attacker)).status);
      now += 1_000;
    }
    expect(statuses.filter((status) => status === 405)).toHaveLength(DENIED_IP_LIMIT);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);

    const valid = await app.request("/mcp", authed(attacker));
    expect(valid.status).toBe(200);
    expect(valid.headers.get("retry-after")).toBeNull();
    expect((await get(app, attacker)).status).toBe(429);
    expect((await get(app, "203.0.113.51")).status).toBe(405);
  });

  it("charges the denial bucket for an invalid token and not for a malformed one", async () => {
    let lookups = 0;
    const denied = testApp({
      deniedPerIp: 10,
      globalDenialCapacity: 1,
      globalDenialRefillPerSecond: 0,
      globalBearerCapacity: 4,
      globalBearerRefillPerSecond: 0,
      authenticator: (header) => {
        if (header === `Bearer ${token("v")}`) return { ok: true, identity: IDENTITY };
        lookups += 1;
        return { ok: false };
      },
    });
    expect((await denied.app.request("/mcp", authed("203.0.113.1", token("b")))).status).toBe(401);
    expect(lookups).toBe(1);
    expect((await get(denied.app, "203.0.113.2")).status).toBe(429);
    expect((await denied.app.request("/mcp", authed("203.0.113.3"))).status).toBe(200);
    expect(lookups).toBe(1);

    const malformed = testApp({
      deniedPerIp: 10,
      globalDenialCapacity: 1,
      globalDenialRefillPerSecond: 0,
      globalBearerCapacity: 1,
      globalBearerRefillPerSecond: 0,
      authenticator: (header) => {
        if (header === `Bearer ${token("v")}`) return { ok: true, identity: IDENTITY };
        return { ok: false };
      },
    });
    const shaped = await malformed.app.request(
      "/mcp",
      request2026({ authorization: "Bearer not-a-token", extraHeaders: { "x-real-ip": "203.0.113.4" } }),
    );
    expect(shaped.status).toBe(401);
    expect((await malformed.app.request("/mcp", authed("203.0.113.5"))).status).toBe(200);
  });

  it("still refuses a new address when the map is full, before verifying a bearer", async () => {
    let lookups = 0;
    const { app } = testApp({
      deniedPerIp: 1,
      deniedMaxIps: 1,
      globalDenialCapacity: 10,
      globalBearerCapacity: 10,
      authenticator: () => {
        lookups += 1;
        return { ok: true, identity: IDENTITY };
      },
    });
    expect((await get(app, "203.0.113.1")).status).toBe(405);
    const blocked = await app.request("/mcp", authed("203.0.113.2"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBe(60);
    expect(lookups).toBe(0);
  });

  it("does not spend the bearer bucket while the kill switch is on", async () => {
    let lookups = 0;
    const { app } = testApp({
      killSwitchEnv: "on",
      globalDenialCapacity: 5,
      globalBearerCapacity: 1,
      globalBearerRefillPerSecond: 0,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const first = await app.request("/mcp", authed("203.0.113.1", token("b")));
    const second = await app.request("/mcp", authed("203.0.113.2", token("b")));
    expect(first.status).toBe(403);
    expect(second.status).toBe(403);
    expect(lookups).toBe(0);
  });
});
