import { describe, expect, it } from "vitest";
import {
  IDENTITY_CALLS_PER_MINUTE,
  IDENTITY_SUBMITS_PER_MINUTE,
  IDENTITY_WINDOW_MS,
  PROTECTED_FIRST_VERIFY_MAX,
  PROTECTED_FIRST_VERIFY_PER_IP,
  WAITING_BEARER_MAX,
  WAITING_BEARER_TTL_MS,
  createApp,
} from "../src/app";
import { ALLOWED_ORIGIN, request2026, spyGuard, testApp } from "./helpers";

const AGENT_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "example-agent",
  scopes: ["cerevex.read"] as const,
};

const AGENT_B = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "other-agent",
  scopes: ["cerevex.read"] as const,
};

const SUBMITTER = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "submit-agent",
  scopes: ["cerevex.read", "cerevex.recs.submit"] as const,
};

function token(mark: string): string {
  return `cxm_${(mark + "a".repeat(43)).slice(0, 43)}`;
}

function call(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  ip: string,
  bearer: string,
  tool?: string,
) {
  return Promise.resolve(
    app.request(
      "/mcp",
      request2026({
        method: tool ? "tools/call" : "tools/list",
        name: tool,
        authorization: `Bearer ${bearer}`,
        extraHeaders: { "x-real-ip": ip },
      }),
    ),
  );
}

describe("per-identity rate limit", () => {
  it("pins the brief §11 defaults", () => {
    expect(IDENTITY_CALLS_PER_MINUTE).toBe(60);
    expect(IDENTITY_SUBMITS_PER_MINUTE).toBe(30);
    expect(IDENTITY_WINDOW_MS).toBe(60_000);
    expect(PROTECTED_FIRST_VERIFY_PER_IP).toBe(1);
    expect(PROTECTED_FIRST_VERIFY_MAX).toBe(60);
    expect(WAITING_BEARER_MAX).toBe(4096);
    expect(WAITING_BEARER_TTL_MS).toBe(60_000);
  });

  it("caps a leaked token at 60 lookups in the window and leaves the other identity alone", async () => {
    let now = 1_000_000;
    let lookups = 0;
    const leaked = token("leak");
    const other = token("othr");
    const { app, guard } = testApp({
      now: () => now,
      globalDenialCapacity: 100,
      globalBearerCapacity: 10,
      authenticator: (header) => {
        lookups += 1;
        if (header === `Bearer ${leaked}`) return { ok: true, identity: AGENT_A };
        if (header === `Bearer ${other}`) return { ok: true, identity: AGENT_B };
        return { ok: false };
      },
    });

    const statuses: number[] = [];
    for (let n = 0; n < IDENTITY_CALLS_PER_MINUTE; n += 1) {
      statuses.push((await call(app, "198.51.100.10", leaked)).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE);

    const blocked = await call(app, "198.51.100.10", leaked);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(((await blocked.json()) as { error: { message: string } }).error.message).toBe("Rate limit exceeded");
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE);

    for (let n = 0; n < 40; n += 1) {
      const again = await call(app, "203.0.113.10", leaked);
      expect(again.status).toBe(429);
      expect(again.headers.get("retry-after")).toBe("60");
    }
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE);

    const neighbor = await call(app, "198.51.100.11", other);
    expect(neighbor.status).toBe(200);
    expect(neighbor.headers.get("retry-after")).toBeNull();
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE + 1);

    const limited = guard.calls.audits.find((entry) => entry.reason === "rate_limited");
    expect(limited).toMatchObject({
      httpStatus: 429,
      result: "rate_limited",
      identityId: AGENT_A.id,
      identityName: AGENT_A.name,
      authType: "agent",
    });

    now += 50_000;
    const closer = await call(app, "198.51.100.10", leaked);
    expect(closer.status).toBe(429);
    expect(closer.headers.get("retry-after")).toBe("10");
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE + 1);

    now += 10_000;
    const renewed = await call(app, "198.51.100.10", leaked);
    expect(renewed.status).toBe(200);
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE + 2);
  });

  it("shares one window across tokens for the same identity", async () => {
    let lookups = 0;
    const first = token("toka");
    const second = token("tokb");
    const { app } = testApp({
      now: () => 5_000_000,
      globalBearerCapacity: 10,
      globalDenialCapacity: 100,
      authenticator: (header) => {
        lookups += 1;
        if (header === `Bearer ${first}` || header === `Bearer ${second}`) return { ok: true, identity: AGENT_A };
        return { ok: false };
      },
    });
    for (let n = 0; n < 30; n += 1) expect((await call(app, "198.51.100.20", first)).status).toBe(200);
    for (let n = 0; n < 30; n += 1) expect((await call(app, "198.51.100.21", second)).status).toBe(200);
    const blocked = await call(app, "198.51.100.22", second);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(lookups).toBe(60);
    expect((await call(app, "198.51.100.23", token("nope"))).status).toBe(401);
  });

  it("charges the identity window before a concurrent burst can pass the check", async () => {
    let lookups = 0;
    const leaked = token("burst");
    const { app } = testApp({
      now: () => 8_000_000,
      globalBearerCapacity: 10,
      globalDenialCapacity: 200,
      authenticator: () => {
        lookups += 1;
        return { ok: true, identity: AGENT_A };
      },
    });
    expect((await call(app, "198.51.100.30", leaked)).status).toBe(200);
    const burst = await Promise.all(
      Array.from({ length: 100 }, () => call(app, "198.51.100.30", leaked)),
    );
    const statuses = await Promise.all(burst.map(async (res) => res.status));
    expect(statuses.filter((status) => status === 200)).toHaveLength(IDENTITY_CALLS_PER_MINUTE - 1);
    expect(statuses.filter((status) => status === 429)).toHaveLength(101 - IDENTITY_CALLS_PER_MINUTE);
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE);
    const limited = burst.find((res) => res.status === 429);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("caps submit_recommendation at 30 per minute without capping reads or validate", async () => {
    let now = 2_000_000;
    const bearer = token("subm");
    const { app } = testApp({
      now: () => now,
      globalBearerCapacity: 80,
      globalDenialCapacity: 200,
      authenticator: () => ({ ok: true, identity: SUBMITTER }),
    });
    const submits: number[] = [];
    for (let n = 0; n < IDENTITY_SUBMITS_PER_MINUTE; n += 1) {
      submits.push((await call(app, "198.51.100.40", bearer, "submit_recommendation")).status);
    }
    expect(submits.every((status) => status === 400)).toBe(true);
    const blocked = await call(app, "198.51.100.40", bearer, "submit_recommendation");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await call(app, "198.51.100.40", bearer)).status).toBe(200);

    const validates = testApp({
      now: () => now,
      globalBearerCapacity: 80,
      globalDenialCapacity: 200,
      authenticator: () => ({ ok: true, identity: SUBMITTER }),
    });
    const dry: number[] = [];
    for (let n = 0; n < IDENTITY_SUBMITS_PER_MINUTE + 1; n += 1) {
      dry.push((await call(validates.app, "198.51.100.41", bearer, "validate_recommendation")).status);
    }
    expect(dry.every((status) => status === 400)).toBe(true);
  });

  it("does not let one address's fake tokens empty the pool a cold token needs", async () => {
    let lookups = 0;
    const good = token("cold");
    const bad = token("fake");
    const { app } = testApp({
      now: () => 3_000_000,
      failedLookupPerIp: 2,
      globalBearerCapacity: 5,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 50,
      authenticator: (header) => {
        lookups += 1;
        if (header === `Bearer ${good}`) return { ok: true, identity: AGENT_A };
        return { ok: false };
      },
    });
    const attacker = "203.0.113.9";
    const flood = [
      await call(app, attacker, bad),
      await call(app, attacker, bad),
      await call(app, attacker, bad),
      await call(app, attacker, bad),
    ];
    expect(flood.map((res) => res.status)).toEqual([401, 401, 429, 429]);
    expect(lookups).toBe(2);
    expect(flood[2]?.headers.get("retry-after")).toBe("60");

    const otherA = await call(app, "203.0.113.21", token("oa"));
    const otherB = await call(app, "203.0.113.22", token("ob"));
    expect(otherA.status).toBe(401);
    expect(otherB.status).toBe(401);
    expect(lookups).toBe(4);

    const cold = await call(app, "198.51.100.50", good);
    expect(cold.status).toBe(200);
    expect(cold.headers.get("retry-after")).toBeNull();
    expect(lookups).toBe(5);
    expect((await call(app, attacker, bad)).status).toBe(429);
    expect(lookups).toBe(5);
  });

  it("admits a retried cold token while a rotating fake flood holds the shared bucket", async () => {
    let lookups = 0;
    const good = token("wait");
    const { app } = testApp({
      now: () => 4_000_000,
      globalBearerCapacity: 2,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 50,
      failedLookupPerIp: 30,
      authenticator: (header) => {
        lookups += 1;
        if (header === `Bearer ${good}`) return { ok: true, identity: AGENT_A };
        return { ok: false };
      },
    });
    const fake = (n: number) => token(`f${n.toString(36)}`);
    expect((await call(app, "203.0.113.1", fake(1))).status).toBe(401);
    expect((await call(app, "203.0.113.2", fake(2))).status).toBe(401);
    expect(lookups).toBe(2);
    expect((await call(app, "203.0.113.3", fake(3))).status).toBe(429);
    expect((await call(app, "203.0.113.4", fake(4))).status).toBe(429);
    expect(lookups).toBe(2);

    const user = "198.51.100.60";
    const first = await call(app, user, good);
    expect(first.status).toBe(429);
    expect(Number(first.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(lookups).toBe(2);

    const second = await call(app, user, good);
    expect(second.status).toBe(200);
    expect(second.headers.get("retry-after")).toBeNull();
    expect(lookups).toBe(3);

    const other = token("nxt1");
    expect((await call(app, user, other)).status).toBe(429);
    expect((await call(app, user, other)).status).toBe(429);
    expect(lookups).toBe(3);

    const later = await call(app, "203.0.113.5", fake(5));
    expect(later.status).toBe(429);
    expect(lookups).toBe(3);
  });

  it("does not give the refilled token to a new fake while a cold token is waiting", async () => {
    let now = 6_000_000;
    let lookups = 0;
    const good = token("hold");
    const { app } = testApp({
      now: () => now,
      globalBearerCapacity: 2,
      globalBearerRefillPerSecond: 1,
      globalDenialCapacity: 50,
      failedLookupPerIp: 30,
      authenticator: (header) => {
        lookups += 1;
        if (header === `Bearer ${good}`) return { ok: true, identity: AGENT_B };
        return { ok: false };
      },
    });
    const fake = (n: number) => token(`r${n.toString(36)}`);
    expect((await call(app, "203.0.113.21", fake(1))).status).toBe(401);
    expect((await call(app, "203.0.113.22", fake(2))).status).toBe(401);
    const waiting = await call(app, "203.0.113.23", fake(3));
    expect(waiting.status).toBe(429);
    expect(lookups).toBe(2);

    const user = "198.51.100.70";
    expect((await call(app, user, good)).status).toBe(429);
    expect(lookups).toBe(2);

    now += 1_000;
    const stolen = await call(app, "203.0.113.24", fake(4));
    expect(stolen.status).toBe(429);
    expect(stolen.headers.get("retry-after")).toBe("1");
    expect(lookups).toBe(2);

    const admitted = await call(app, user, good);
    expect(admitted.status).toBe(200);
    expect(lookups).toBe(3);
  });

  it("still verifies a protected retry, and an address that already failed cannot use it", async () => {
    let lookups = 0;
    const good = token("revk");
    const { app } = testApp({
      now: () => 7_000_000,
      globalBearerCapacity: 2,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 20,
      failedLookupPerIp: 5,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const dirty = "198.51.100.80";
    expect((await call(app, dirty, token("bad1"))).status).toBe(401);
    expect((await call(app, "203.0.113.31", token("drain"))).status).toBe(401);
    expect(lookups).toBe(2);

    const first = await call(app, dirty, good);
    const second = await call(app, dirty, good);
    expect(first.status).toBe(429);
    expect(second.status).toBe(429);
    expect(lookups).toBe(2);

    const clean = "198.51.100.81";
    const fresh = token("clen");
    expect((await call(app, clean, fresh)).status).toBe(429);
    expect(lookups).toBe(2);
    const retried = await call(app, clean, fresh);
    expect(retried.status).toBe(401);
    expect(lookups).toBe(3);
    const another = token("clen2");
    expect((await call(app, clean, another)).status).toBe(429);
    expect((await call(app, clean, another)).status).toBe(429);
    expect(lookups).toBe(3);
  });

  it("caps protected retries so rotating addresses cannot mint a lookup each", async () => {
    let lookups = 0;
    const { app } = testApp({
      now: () => 9_000_000,
      globalBearerCapacity: 1,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 50,
      failedLookupPerIp: 30,
      protectedFirstVerifyPerMinute: 2,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const once = async (ip: string, mark: string) => call(app, ip, token(mark));
    expect((await once("203.0.113.41", "p0")).status).toBe(401);
    expect(lookups).toBe(1);
    const pairs: number[] = [];
    for (let n = 1; n <= 6; n += 1) {
      const ip = `203.0.113.${50 + n}`;
      const mark = `p${n.toString(36)}`;
      pairs.push((await once(ip, mark)).status, (await once(ip, mark)).status);
    }
    expect(pairs.filter((status) => status === 401).length).toBe(2);
    expect(lookups).toBe(1 + 2);
    expect(pairs.filter((status) => status === 429).length).toBe(pairs.length - 2);
  });

  it("drops the oldest waiting hash once the set reaches its cap", async () => {
    let lookups = 0;
    const { app } = testApp({
      now: () => 11_000_000,
      globalBearerCapacity: 0,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 10,
      failedLookupPerIp: 5,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const ipFor = (n: number) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
    const bearerFor = (n: number) => `cxm_${n.toString(36).padStart(43, "0")}`;
    for (let n = 0; n < WAITING_BEARER_MAX; n += 1) {
      expect((await call(app, ipFor(n), bearerFor(n))).status).toBe(429);
    }
    expect((await call(app, ipFor(WAITING_BEARER_MAX), bearerFor(WAITING_BEARER_MAX))).status).toBe(429);
    expect(lookups).toBe(0);

    const evicted = await call(app, ipFor(0), bearerFor(0));
    expect(evicted.status).toBe(429);
    expect(lookups).toBe(0);

    const kept = await call(app, ipFor(WAITING_BEARER_MAX), bearerFor(WAITING_BEARER_MAX));
    expect(kept.status).toBe(401);
    expect(lookups).toBe(1);
  }, 30_000);

  it("stops treating a hash as waiting after the 60s expiry", async () => {
    let now = 12_000_000;
    let lookups = 0;
    const { app } = testApp({
      now: () => now,
      globalBearerCapacity: 0,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 10,
      failedLookupPerIp: 5,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const older = token("olda");
    const newer = token("newa");
    expect((await call(app, "198.51.100.1", older)).status).toBe(429);
    expect((await call(app, "198.51.100.2", newer)).status).toBe(429);
    expect(lookups).toBe(0);

    now += WAITING_BEARER_TTL_MS - 1;
    expect((await call(app, "198.51.100.2", newer)).status).toBe(401);
    expect(lookups).toBe(1);

    now += 1;
    const expired = await call(app, "198.51.100.1", older);
    expect(expired.status).toBe(429);
    expect(lookups).toBe(1);
  });

  it("forgets a waiting entry after its protected verify", async () => {
    let now = 13_000_000;
    let lookups = 0;
    const bearer = token("once");
    const { app } = testApp({
      now: () => now,
      globalBearerCapacity: 0,
      globalBearerRefillPerSecond: 0,
      globalDenialCapacity: 10,
      failedLookupPerIp: 10,
      deniedWindowMs: 1_000,
      identityWindowMs: 1_000,
      authenticator: () => {
        lookups += 1;
        return { ok: false };
      },
    });
    const ip = "198.51.100.77";
    expect((await call(app, ip, bearer)).status).toBe(429);
    expect((await call(app, ip, bearer)).status).toBe(401);
    expect(lookups).toBe(1);

    now += 1_000;
    expect((await call(app, ip, bearer)).status).toBe(429);
    expect(lookups).toBe(1);
  });

  it("does not charge an identity while the env kill switch is on", async () => {
    let now = 14_000_000;
    let lookups = 0;
    const kill = { value: undefined as string | undefined };
    const guard = spyGuard();
    const app = createApp({
      allowedOrigins: ALLOWED_ORIGIN,
      get killSwitchEnv() {
        return kill.value;
      },
      guards: guard.client,
      now: () => now,
      globalBearerCapacity: 10,
      globalDenialCapacity: 100,
      authenticator: () => {
        lookups += 1;
        return { ok: true, identity: AGENT_A };
      },
    });
    const bearer = token("kill");
    for (let n = 0; n < IDENTITY_CALLS_PER_MINUTE - 1; n += 1) {
      expect((await call(app, "198.51.100.90", bearer)).status).toBe(200);
    }
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE - 1);

    kill.value = "on";
    const blocked = await call(app, "198.51.100.90", bearer);
    expect(blocked.status).toBe(403);
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE - 1);

    kill.value = undefined;
    const after = await call(app, "198.51.100.90", bearer);
    expect(after.status).toBe(200);
    expect(lookups).toBe(IDENTITY_CALLS_PER_MINUTE);
  });
});
