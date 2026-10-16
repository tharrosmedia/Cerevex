import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import { and, eq, like } from "drizzle-orm";
import { jwtVerify } from "jose";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clients, mcpIdentities, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import {
  ownerAssertionKeyBytes,
  signOwnerAssertion,
  type OwnerAssertionClaims,
} from "@cerevex/contracts/owner-assertion";
import {
  OWNER_ASSERTION_JTI_CAP,
  OWNER_ASSERTION_JTI_TTL_MS,
  OWNER_ASSERTION_REPLICA_WARNING,
  assertOwnerAssertionSecretsDistinct,
  ownerAssertionReplicaWarning,
  rememberOwnerAssertionJti,
  resetOwnerAssertionForTests,
  warnOwnerAssertionBoot,
} from "../src/owner-assertion";
import { app, json, login } from "./helpers";

const logs = vi.hoisted(() => [] as Array<{ requestId?: string; event: Record<string, unknown> }>);

vi.mock("../src/logger", () => ({
  logger: {
    warn: (event: Record<string, unknown>) => logs.push({ event }),
    info: (event: Record<string, unknown>) => logs.push({ event }),
    error: (event: Record<string, unknown>) => logs.push({ event }),
  },
  childLogger: (requestId: string) => ({
    warn: (event: Record<string, unknown>) => logs.push({ requestId, event }),
    info: (event: Record<string, unknown>) => logs.push({ requestId, event }),
    error: (event: Record<string, unknown>) => logs.push({ requestId, event }),
  }),
  newRequestId: (incoming?: string | null) => (incoming && incoming.trim().length > 0 ? incoming : "generated-request"),
}));

const CURRENT = Buffer.alloc(32, 11).toString("base64url");
const PREVIOUS = Buffer.alloc(32, 12).toString("base64url");
const OTHER = Buffer.alloc(32, 13).toString("base64url");
const INTERNAL_KEY = "owner-assertion-internal-key";
const MCP_KEY = "owner-assertion-mcp-key";
const OPERATOR_EMAIL = "owner.assertion.operator@tharrosmedia.com";
const MULTI_EMAIL = "owner.assertion.multi@tharrosmedia.com";
const UNKNOWN_EMAIL = "nobody-owner-assertion@example.com";
const REQUEST_ID = "req-owner-assertion";

const originalEnv = {
  OWNER_ASSERTION_ENABLED: process.env.OWNER_ASSERTION_ENABLED,
  CEREVEX_OWNER_ASSERTION_SECRET: process.env.CEREVEX_OWNER_ASSERTION_SECRET,
  CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS: process.env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS,
  ADS_INTERNAL_KEY: process.env.ADS_INTERNAL_KEY,
  MCP_SERVICE_KEY: process.env.MCP_SERVICE_KEY,
  ADS_INTERNAL_WORKSPACE_ID: process.env.ADS_INTERNAL_WORKSPACE_ID,
  JWT_SECRET: process.env.JWT_SECRET,
  APP_PASSWORD: process.env.APP_PASSWORD,
  CEREVEX_REQUIRE_SIGNING_SECRETS: process.env.CEREVEX_REQUIRE_SIGNING_SECRETS,
  RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
  RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
  NODE_ENV: process.env.NODE_ENV,
};

let workspaceId = "";
let otherWorkspaceId = "";
let ownerEmail = "";
let ownerId = "";
let operatorId = "";
let multiId = "";

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function mint(overrides?: {
  sub?: string;
  wid?: string;
  htm?: string;
  htu?: string;
  secret?: string;
  now?: number;
  kid?: "cur" | "prev";
  jti?: string;
}): string {
  return signOwnerAssertion({
    sub: overrides?.sub ?? ownerEmail,
    wid: overrides?.wid ?? workspaceId,
    htm: overrides?.htm ?? "GET",
    htu: overrides?.htu ?? "/mcp/identities",
    secret: overrides?.secret ?? CURRENT,
    now: overrides?.now ?? Math.floor(Date.now() / 1000),
    kid: overrides?.kid,
    jti: overrides?.jti,
  });
}

function resign(payload: Record<string, unknown>, secret = CURRENT): string {
  const key = ownerAssertionKeyBytes(secret);
  if (!key) throw new Error("test key missing");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "cur" }), "utf8").toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function payloadOf(token: string): OwnerAssertionClaims {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as OwnerAssertionClaims;
}

function events(msg: string) {
  return logs.filter((entry) => entry.event.msg === msg);
}

async function call(
  path: string,
  token: string | null,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  const headers: Record<string, string> = {
    "x-request-id": REQUEST_ID,
    ...(init?.headers ?? {}),
  };
  if (token) headers["x-cerevex-owner-assertion"] = token;
  return app.request(path, { method: init?.method ?? "GET", headers, body: init?.body });
}

describe("owner assertion verification", () => {
  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.MCP_SERVICE_KEY = MCP_KEY;
    ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com").toLowerCase();
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    const owner = await db.query.users.findFirst({ where: eq(users.email, ownerEmail) });
    if (!owner) throw new Error("Seed owner missing");
    ownerId = owner.id;

    const passwordHash = await hash("owner-assertion-local-only", 10);
    operatorId = await ensureUser(OPERATOR_EMAIL, "Owner assertion operator", passwordHash);
    multiId = await ensureUser(MULTI_EMAIL, "Owner assertion multi", passwordHash);
    await db.insert(memberships).values({ userId: operatorId, workspaceId, role: "operator" }).onConflictDoNothing();
    await db.insert(memberships).values({ userId: multiId, workspaceId, role: "owner" }).onConflictDoNothing();
    const [other] = await db.insert(workspaces).values({ name: `Owner assertion other ${Date.now()}` }).returning();
    if (!other) throw new Error("other workspace missing");
    otherWorkspaceId = other.id;
    await db.insert(memberships).values({ userId: multiId, workspaceId: otherWorkspaceId, role: "owner" }).onConflictDoNothing();
  });

  beforeEach(() => {
    logs.length = 0;
    resetOwnerAssertionForTests();
    process.env.OWNER_ASSERTION_ENABLED = "1";
    process.env.CEREVEX_OWNER_ASSERTION_SECRET = CURRENT;
    delete process.env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS;
    delete process.env.CEREVEX_REQUIRE_SIGNING_SECRETS;
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.MCP_SERVICE_KEY = MCP_KEY;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      await db.delete(clients).where(eq(clients.siteId, "owner-assertion-site"));
      await db.delete(mcpIdentities).where(and(eq(mcpIdentities.workspaceId, workspaceId), like(mcpIdentities.name, "oa-%")));
    }
    for (const userId of [operatorId, multiId]) {
      if (!userId) continue;
      await db.delete(memberships).where(eq(memberships.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) restoreEnv(key);
    await closeDb();
  });

  it("accepts a current-key assertion and records the owner as the audit actor", async () => {
    const listed = await call("/mcp/identities", mint());
    expect(listed.status).toBe(200);
    const body = await json(listed);
    expect(Array.isArray(body.identities)).toBe(true);
    expect(events("owner_assertion.accepted")).toEqual([{ requestId: REQUEST_ID, event: { msg: "owner_assertion.accepted" } }]);

    const name = `oa-${Date.now().toString(36)}`.slice(0, 40);
    const created = await call("/mcp/identities", mint({ htm: "POST", htu: "/mcp/identities" }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes: ["cerevex.read"], clientIds: [] }),
    });
    expect(created.status).toBe(200);
    const createdBody = await json(created);
    const identityId = String((createdBody.identity as { id?: string } | undefined)?.id ?? "");
    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "mcp.identity.create"));
    const audit = audits.find((row) => row.entityId === identityId);
    expect(audit?.actorType).toBe("user");
    expect(audit?.actorId).toBe(ownerId);
    expect(JSON.stringify(logs)).not.toContain(ownerEmail);
    expect(JSON.stringify(logs)).not.toContain("eyJ");
  });

  it("cross-checks the helper token with jose", async () => {
    const now = 1_700_000_000;
    const token = mint({ now, sub: "Adam@TharrosMedia.com" });
    const key = ownerAssertionKeyBytes(CURRENT);
    expect(key).toBeTruthy();
    const { payload, protectedHeader } = await jwtVerify(token, key!, {
      issuer: "cerevex-brain",
      audience: "cerevex-ads-api",
      algorithms: ["HS256"],
      clockTolerance: 30,
      currentDate: new Date(now * 1000),
    });
    expect(protectedHeader.alg).toBe("HS256");
    expect(protectedHeader.kid).toBe("cur");
    expect(payload.sub).toBe("adam@tharrosmedia.com");
    expect(payload.exp).toBe(now + 60);
  });

  it("rejects the wrong audience, issuer, method, and path", async () => {
    const claims = payloadOf(mint());
    const wrongAud = await call("/mcp/identities", resign({ ...claims, aud: "somewhere-else" }));
    expect(wrongAud.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("wrong_iss_aud");

    const wrongIss = await call("/mcp/identities", resign({ ...claims, iss: "not-brain" }));
    expect(wrongIss.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("wrong_iss_aud");

    const wrongMethod = await call("/mcp/identities", mint({ htm: "POST" }));
    expect(wrongMethod.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("wrong_htm_htu");

    const wrongPath = await call("/mcp/identities", mint({ htu: "/mcp/identities?x=1" }));
    expect(wrongPath.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("wrong_htm_htu");
    expect(JSON.stringify(events("owner_assertion.rejected"))).not.toContain(ownerEmail);
  });

  it("rejects an expired token, a future iat, a bad signature, and a replayed jti", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await call("/mcp/identities", mint({ now: now - 120 }));
    expect(expired.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("expired");

    const future = await call("/mcp/identities", mint({ now: now + 120 }));
    expect(future.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("future_iat");

    const token = mint();
    const flip = (value: string) => `${value.slice(0, -1)}${value.endsWith("a") ? "b" : "a"}`;
    const bad = await call("/mcp/identities", flip(token));
    expect(bad.status).toBe(401);
    const badAgain = await call("/mcp/identities", flip(mint()));
    expect(badAgain.status).toBe(401);
    const badSigs = events("owner_assertion.rejected").filter((entry) => entry.event.reason === "bad_sig");
    expect(badSigs.map((entry) => entry.event.count)).toEqual([1, 2]);

    const replay = mint();
    expect((await call("/mcp/identities", replay)).status).toBe(200);
    const again = await call("/mcp/identities", replay);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "Sign in required", requestId: REQUEST_ID });
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("replayed");
  });

  it("accepts the previous key and rejects a key outside current and previous", async () => {
    process.env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS = PREVIOUS;
    const accepted = await call("/mcp/identities", mint({ secret: PREVIOUS, kid: "prev" }));
    expect(accepted.status).toBe(200);
    const hinted = await call("/mcp/identities", mint({ secret: PREVIOUS, kid: "cur" }));
    expect(hinted.status).toBe(200);
    const outsider = await call("/mcp/identities", mint({ secret: OTHER }));
    expect(outsider.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("bad_sig");
  });

  it("fails closed when the flag is off or the secret is missing, with no static-token fallback", async () => {
    delete process.env.OWNER_ASSERTION_ENABLED;
    const flaggedOff = await call("/mcp/identities", mint());
    expect(flaggedOff.status).toBe(401);
    expect(await flaggedOff.json()).toEqual({ error: "Sign in required", requestId: REQUEST_ID });
    expect(events("owner_assertion.rejected")).toEqual([]);
    expect(events("owner_assertion.accepted")).toEqual([]);

    process.env.OWNER_ASSERTION_ENABLED = "1";
    delete process.env.CEREVEX_OWNER_ASSERTION_SECRET;
    const jwtKey = Buffer.alloc(32, 21).toString("base64url");
    process.env.JWT_SECRET = jwtKey;
    const missing = await call("/mcp/identities", mint({ secret: jwtKey }));
    expect(missing.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("missing_secret");

    process.env.CEREVEX_OWNER_ASSERTION_SECRET = "short";
    const short = await call("/mcp/identities", mint());
    expect(short.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("missing_secret");

    process.env.CEREVEX_OWNER_ASSERTION_SECRET = CURRENT;
    const session = await login(ownerEmail, process.env.SEED_OWNER_PASSWORD ?? "local-dev-only");
    const bearerAndBadAssertion = await call("/auth/me", mint({ secret: OTHER }), {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(bearerAndBadAssertion.status).toBe(401);
    expect(events("owner_assertion.accepted")).toEqual([]);
  });

  it("still accepts a session when the flag is on and no assertion is sent", async () => {
    const session = await login(ownerEmail, process.env.SEED_OWNER_PASSWORD ?? "local-dev-only");
    const me = await call("/auth/me", null, { headers: { authorization: `Bearer ${session.token}` } });
    expect(me.status).toBe(200);
    expect(events("owner_assertion.rejected")).toEqual([]);
  });

  it("rejects an unknown email, a non-owner, a multi-owner, and a wid mismatch", async () => {
    const unknown = await call("/mcp/identities", mint({ sub: UNKNOWN_EMAIL }));
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).not.toContain(UNKNOWN_EMAIL);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("unknown_user");
    expect(JSON.stringify(logs)).not.toContain(UNKNOWN_EMAIL);

    const operator = await call("/mcp/identities", mint({ sub: OPERATOR_EMAIL }));
    expect(operator.status).toBe(403);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("not_owner");

    const multi = await call("/mcp/identities", mint({ sub: MULTI_EMAIL }));
    expect(multi.status).toBe(403);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("multi_owner");

    const mismatch = await call("/mcp/identities", mint({ wid: otherWorkspaceId }));
    expect(mismatch.status).toBe(403);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("wid_mismatch");
  });

  it("requires owner on an owner-or-operator route and still refuses internal and MCP keys", async () => {
    const site = "/sites/owner-assertion-site/client";
    const body = JSON.stringify({ name: "Owner assertion site" });
    const headers = { "content-type": "application/json" };
    const operator = await call(site, mint({ sub: OPERATOR_EMAIL, htm: "PUT", htu: site }), { method: "PUT", headers, body });
    expect(operator.status).toBe(403);
    expect(events("owner_assertion.rejected").at(-1)?.event.reason).toBe("not_owner");

    const owner = await call(site, mint({ htm: "PUT", htu: site }), {
      method: "PUT",
      headers,
      body: JSON.stringify({}),
    });
    expect(owner.status).toBe(400);

    const internal = await app.request("/mcp/identities", { headers: { "x-cerevex-internal-key": INTERNAL_KEY } });
    expect(internal.status).toBe(403);
    const mcp = await app.request("/mcp/identities", { headers: { "x-cerevex-mcp-key": MCP_KEY } });
    expect(mcp.status).toBe(401);

    delete process.env.OWNER_ASSERTION_ENABLED;
    const internalWhileOff = await app.request("/mcp/identities", { headers: { "x-cerevex-internal-key": INTERNAL_KEY } });
    expect(internalWhileOff.status).toBe(403);
  });

  it("rejects an internal key sent together with an assertion", async () => {
    const both = await call("/mcp/identities", mint(), { headers: { "x-cerevex-internal-key": INTERNAL_KEY } });
    expect(both.status).toBe(401);
    expect(events("owner_assertion.rejected").at(-1)?.event).toEqual({ msg: "owner_assertion.rejected", reason: "ambiguous", count: 1 });
    expect(events("owner_assertion.accepted")).toEqual([]);
  });

  it("refuses a boot when the assertion secret copies another credential", () => {
    process.env.CEREVEX_REQUIRE_SIGNING_SECRETS = "1";
    process.env.JWT_SECRET = CURRENT;
    process.env.CEREVEX_OWNER_ASSERTION_SECRET = CURRENT;
    try {
      expect(() => assertOwnerAssertionSecretsDistinct()).toThrow(/must not equal JWT_SECRET/);
      process.env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS = INTERNAL_KEY;
      process.env.CEREVEX_OWNER_ASSERTION_SECRET = PREVIOUS;
      expect(() => assertOwnerAssertionSecretsDistinct()).toThrow(/PREVIOUS must not equal ADS_INTERNAL_KEY/);
    } finally {
      delete process.env.CEREVEX_REQUIRE_SIGNING_SECRETS;
      delete process.env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS;
      restoreEnv("JWT_SECRET");
    }
    expect(() => assertOwnerAssertionSecretsDistinct()).not.toThrow();
  });

  it("warns at boot when more than one replica is configured", () => {
    expect(ownerAssertionReplicaWarning({})).toBeNull();
    expect(ownerAssertionReplicaWarning({ RAILWAY_REPLICA_ID: "8f3c2a10-1b9e-4a6d-9c11-0aa11bb22cc3" })).toBeNull();
    expect(ownerAssertionReplicaWarning({ RAILWAY_REPLICA_ID: "0" })).toBeNull();
    expect(ownerAssertionReplicaWarning({ REPLICA_COUNT: "1" })).toBeNull();
    expect(ownerAssertionReplicaWarning({ RAILWAY_REPLICA_ID: "1" })).toBe(OWNER_ASSERTION_REPLICA_WARNING);
    expect(ownerAssertionReplicaWarning({ RAILWAY_REPLICA_COUNT: "2" })).toBe(OWNER_ASSERTION_REPLICA_WARNING);
    expect(ownerAssertionReplicaWarning({ RAILWAY_NUM_REPLICAS: "3" })).toBe(OWNER_ASSERTION_REPLICA_WARNING);
    expect(ownerAssertionReplicaWarning({ REPLICA_COUNT: "2" })).toBe(OWNER_ASSERTION_REPLICA_WARNING);

    const messages: string[] = [];
    warnOwnerAssertionBoot((message) => messages.push(message), {
      CEREVEX_OWNER_ASSERTION_SECRET: CURRENT,
      RAILWAY_REPLICA_ID: "1",
    });
    expect(messages).toEqual([OWNER_ASSERTION_REPLICA_WARNING]);

    const missing: string[] = [];
    warnOwnerAssertionBoot((message) => missing.push(message), {});
    expect(missing.some((message) => message.includes("missing or short"))).toBe(true);
    expect(missing.some((message) => message === OWNER_ASSERTION_REPLICA_WARNING)).toBe(false);

    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toContain("warnOwnerAssertionBoot");
    expect(source).toContain("assertOwnerAssertionSecretsDistinct");
    const cache = readFileSync(new URL("../src/owner-assertion.ts", import.meta.url), "utf8");
    expect(cache).toContain("must move to a shared store before");
  });

  it("keeps a single-use jti cache with a 90s ttl and a 10k cap", () => {
    expect(rememberOwnerAssertionJti("first", 0)).toBe(true);
    expect(rememberOwnerAssertionJti("first", OWNER_ASSERTION_JTI_TTL_MS - 1)).toBe(false);
    expect(rememberOwnerAssertionJti("first", OWNER_ASSERTION_JTI_TTL_MS)).toBe(true);

    resetOwnerAssertionForTests();
    for (let i = 0; i < OWNER_ASSERTION_JTI_CAP; i += 1) {
      expect(rememberOwnerAssertionJti(`jti-${i}`, 1)).toBe(true);
    }
    expect(rememberOwnerAssertionJti("jti-0", 1)).toBe(false);
    expect(rememberOwnerAssertionJti("jti-overflow", 1)).toBe(true);
    expect(rememberOwnerAssertionJti("jti-0", 1)).toBe(true);
  });
});

async function ensureUser(email: string, name: string, passwordHash: string): Promise<string> {
  const db = getDb();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    await db.update(users).set({ passwordHash, name }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await db.insert(users).values({ email, name, passwordHash }).returning();
  if (!created) throw new Error(`could not create ${email}`);
  return created.id;
}
