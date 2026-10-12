import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import { and, desc, eq } from "drizzle-orm";
import { GOOGLE_ADS_API_VERSION } from "@tharros/ads-shared";
import { containsRawSecret } from "@tharros/ads-shared/crypto";
import { storeTokens } from "@tharros/ads-shared/credentials";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import {
  GOOGLE_ACCESS_UNKNOWN_MESSAGE,
  GOOGLE_NEEDS_RECONNECT_MESSAGE,
  GOOGLE_NOT_CONFIGURED_MESSAGE,
  GOOGLE_PERMISSION_DENIED_MESSAGE,
  GOOGLE_PROJECT_NOT_APPROVED_CODE,
  GOOGLE_PROJECT_NOT_APPROVED_MESSAGE,
  GOOGLE_READY_MESSAGE,
  GOOGLE_READINESS_CHECKED,
  classifyGoogleAdsHttp,
} from "@tharros/ads-shared/google-access";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { adAccounts, adEntities, auditLog, clients, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import {
  GOOGLE_API_STARTUP_WARNING,
  GOOGLE_WORKER_STARTUP_WARNING,
  warnIfGoogleNotConfigured,
  workerHealthBody,
} from "@tharros/ads-shared/worker-health";
import { app, ensureScopedUser, json, login } from "./helpers";

const CLIENT_ID = "g3-google-client-id-value";
const CLIENT_SECRET = "g3-google-client-secret-value";
const DEV_TOKEN = "g3-google-developer-token-value";
const ACCESS = "g3-google-access-token-value";
const REFRESH = "g3-google-refresh-token-value";
const BAIT = "g3-google-error-body-bait";
const SECRETS = [CLIENT_ID, CLIENT_SECRET, DEV_TOKEN, ACCESS, REFRESH, BAIT];
const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const CHECKED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = SAVED_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearGoogleEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function configureGoogleEnv() {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = DEV_TOKEN;
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    expect(text.includes(secret)).toBe(false);
  }
  expect(containsRawSecret(value)).toBe(false);
}

function googleError(status: string, extra: Record<string, unknown> = {}) {
  return {
    error: {
      code: status === "UNAUTHENTICATED" ? 401 : 403,
      status,
      message: BAIT,
      ...extra,
    },
  };
}

describe("Google access status mapping", () => {
  it("maps each live result to a plain status", () => {
    expect(classifyGoogleAdsHttp(200, { resourceNames: ["customers/9988776655"] })).toBe("ok");
    expect(classifyGoogleAdsHttp(401, googleError("UNAUTHENTICATED"))).toBe("needs_reconnect");
    expect(classifyGoogleAdsHttp(400, { error: "invalid_grant", error_description: BAIT })).toBe("needs_reconnect");
    expect(
      classifyGoogleAdsHttp(403, googleError("PERMISSION_DENIED", { details: [{ reason: "SERVICE_DISABLED" }] })),
    ).toBe("permission_denied");
    expect(
      classifyGoogleAdsHttp(403, {
        error: {
          status: "PERMISSION_DENIED",
          message: BAIT,
          details: [
            {
              errors: [{ errorCode: { authorizationError: GOOGLE_PROJECT_NOT_APPROVED_CODE } }],
            },
          ],
        },
      }),
    ).toBe("project_not_approved");
    expect(classifyGoogleAdsHttp(500, { error: { message: BAIT } })).toBe("unknown");
  });
});

describe("Google readiness on /health", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("reports configured flags only, with a UTC checkedAt, and warns once when Google is missing", async () => {
    clearGoogleEnv();
    process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
    const now = new Date("2026-10-12T15:04:00.000Z");
    const missing = workerHealthBody({ dbOk: true, inngestStatus: "ok", functionIds: ["ads-sync"], now });
    expect(missing.oauth.google.configured).toBe(false);
    expect(missing.oauth.google.readiness).toBe("not_configured");
    expect(missing.oauth.google.checkedAt).toBe("2026-10-12T15:04:00.000Z");
    expect(missing.time).toBe(missing.oauth.google.checkedAt);
    expect(Object.keys(missing.oauth.google).sort()).toEqual(
      ["apiVersion", "checkedAt", "configured", "readiness", "redirectUri"].sort(),
    );
    expectNoSecrets(missing);

    const lines: string[] = [];
    expect(warnIfGoogleNotConfigured("worker", (message) => lines.push(message))).toBe(true);
    expect(warnIfGoogleNotConfigured("api", (message) => lines.push(message))).toBe(true);
    expect(lines).toEqual([GOOGLE_WORKER_STARTUP_WARNING, GOOGLE_API_STARTUP_WARNING]);
    expectNoSecrets(lines);

    configureGoogleEnv();
    const ready = workerHealthBody({ dbOk: true, inngestStatus: "ok", functionIds: ["ads-sync"], now });
    expect(ready.oauth.google.configured).toBe(true);
    expect(ready.oauth.google.readiness).toBe("ready");
    expect(ready.oauth.google.apiVersion).toBe(GOOGLE_ADS_API_VERSION);
    expect(warnIfGoogleNotConfigured("worker", (message) => lines.push(message))).toBe(false);
    expect(lines).toHaveLength(2);
    expectNoSecrets(ready);

    clearGoogleEnv();
    const apiMissing = await app.request("/health");
    const missingBody = await json(apiMissing);
    const missingGoogle = (missingBody.oauth as { google: Record<string, unknown> }).google;
    expect(missingGoogle.configured).toBe(false);
    expect(missingGoogle.readiness).toBe("not_configured");
    expect(missingGoogle.checkedAt).toMatch(CHECKED_AT);
    expectNoSecrets(missingBody);

    configureGoogleEnv();
    const apiReady = await app.request("/health");
    const readyBody = await json(apiReady);
    const readyGoogle = (readyBody.oauth as { google: Record<string, unknown> }).google;
    expect(readyGoogle.configured).toBe(true);
    expect(readyGoogle.readiness).toBe("ready");
    expect(readyGoogle.apiVersion).toBe(GOOGLE_ADS_API_VERSION);
    expect(readyGoogle.checkedAt).toMatch(CHECKED_AT);
    expect(readyBody.time).toBe(readyGoogle.checkedAt);
    expectNoSecrets(readyBody);
  });

  it("wires the startup warning into ads-api and ads-workers", () => {
    const api = readFileSync(path.resolve(HERE, "../src/index.ts"), "utf8");
    const worker = readFileSync(path.resolve(HERE, "../../workers/src/index.ts"), "utf8");
    expect(api).toContain('warnIfGoogleNotConfigured("api"');
    expect(worker).toContain('warnIfGoogleNotConfigured("worker"');
  });
});

describe("Check Google Ads access", () => {
  let ownerToken = "";
  let operatorToken = "";
  let workspaceId = "";
  let clientId = "";
  let ownerId = "";

  beforeAll(async () => {
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    ownerToken = owner.token;
    const ownerUser = await getDb().query.users.findFirst({
      where: eq(users.email, process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com"),
    });
    if (!ownerUser) throw new Error("Seed owner missing");
    ownerId = ownerUser.id;

    const [workspace] = await getDb()
      .insert(workspaces)
      .values({ name: `G3 readiness ${Date.now()}` })
      .returning();
    workspaceId = workspace.id;
    const [client] = await getDb()
      .insert(clients)
      .values({ workspaceId, name: "G3 readiness site" })
      .returning();
    clientId = client.id;
    await getDb().insert(memberships).values({ userId: ownerId, workspaceId, role: "owner" });

    const email = "g3.operator@tharrosmedia.com";
    const passwordHash = await hash("g3-operator-local", 10);
    const existing = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ??
      (await getDb().insert(users).values({ email, name: "G3 operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await getDb().update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await getDb().insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" });
    operatorToken = (await login(email, "g3-operator-local")).token;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  afterAll(() => {
    restoreEnv();
  });

  async function audits() {
    return getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, GOOGLE_READINESS_CHECKED)))
      .orderBy(desc(auditLog.createdAt));
  }

  async function check(token: string) {
    const before = await audits();
    const res = await app.request("/oauth/google/access-check", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const body = await json(res);
    const after = await audits();
    return { status: res.status, body, before, after };
  }

  function stubFetch(status: number, payload: unknown) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
    return calls;
  }

  async function seedRealToken(externalId: string) {
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "google",
        externalId,
        displayName: "G3 access check",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "google",
      label: "live",
      tokens: { accessToken: ACCESS, refreshToken: REFRESH, mock: false },
    });
    return account;
  }

  function expectPublicStatus(
    body: Record<string, unknown>,
    status: string,
    readiness: string,
    message: string,
  ) {
    expect(body).toEqual({
      status,
      readiness,
      message,
      checkedAt: expect.stringMatching(CHECKED_AT),
    });
    expectNoSecrets(body);
  }

  it("refuses anyone who is not an owner before calling Google", async () => {
    configureGoogleEnv();
    const account = await seedRealToken(`g3-role-${Date.now()}`);
    const calls = stubFetch(200, { resourceNames: ["customers/9988776655"] });
    try {
      const anon = await app.request("/oauth/google/access-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      expect(anon.status).toBe(401);

      const result = await check(operatorToken);
      expect(result.status).toBe(403);
      expect(result.body.error).toBe("Only a workspace owner can check Google Ads access.");
      expect(calls).toHaveLength(0);
      expect(result.after.length).toBe(result.before.length + 1);
      expect(result.after[0]?.payloadJson).toEqual({ allowed: false });
      expectNoSecrets(result.body);
      expectNoSecrets(result.after[0]?.payloadJson);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("returns not configured without a live call when the client is unset", async () => {
    clearGoogleEnv();
    const calls = stubFetch(200, { resourceNames: [] });
    const result = await check(ownerToken);
    expect(result.status).toBe(200);
    expectPublicStatus(result.body, "not_configured", "not_configured", GOOGLE_NOT_CONFIGURED_MESSAGE);
    expect(calls).toHaveLength(0);
    expect(result.after[0]?.payloadJson).toMatchObject({
      allowed: true,
      status: "not_configured",
      readiness: "not_configured",
      message: GOOGLE_NOT_CONFIGURED_MESSAGE,
    });
    expectNoSecrets(result.after[0]?.payloadJson);
  });

  it("returns needs reconnect when no real Google token is stored", async () => {
    configureGoogleEnv();
    const calls = stubFetch(200, { resourceNames: ["customers/9988776655"] });
    const result = await check(ownerToken);
    expect(result.status).toBe(200);
    expectPublicStatus(result.body, "needs_reconnect", "unknown", GOOGLE_NEEDS_RECONNECT_MESSAGE);
    expect(calls).toHaveLength(0);
    expectNoSecrets(result.after[0]?.payloadJson);
  });

  it("returns needs reconnect when list-accessible-customers rejects the token", async () => {
    configureGoogleEnv();
    const account = await seedRealToken(`g3-reconnect-${Date.now()}`);
    const calls = stubFetch(401, googleError("UNAUTHENTICATED"));
    try {
      const result = await check(ownerToken);
      expect(result.status).toBe(200);
      expectPublicStatus(result.body, "needs_reconnect", "unknown", GOOGLE_NEEDS_RECONNECT_MESSAGE);
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0].url).pathname).toBe(
        `/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
      );
      expectNoSecrets(result.after[0]?.payloadJson);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("returns permission denied when the API is disabled", async () => {
    configureGoogleEnv();
    const account = await seedRealToken(`g3-permission-${Date.now()}`);
    const calls = stubFetch(
      403,
      googleError("PERMISSION_DENIED", {
        details: [{ reason: "SERVICE_DISABLED", metadata: { consumer: BAIT } }],
      }),
    );
    try {
      const result = await check(ownerToken);
      expect(result.status).toBe(200);
      expectPublicStatus(result.body, "permission_denied", "unknown", GOOGLE_PERMISSION_DENIED_MESSAGE);
      expect(calls).toHaveLength(1);
      expectNoSecrets(result.after[0]?.payloadJson);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("maps CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION to the plain project sentence", async () => {
    configureGoogleEnv();
    const account = await seedRealToken(`g3-project-${Date.now()}`);
    const calls = stubFetch(403, {
      error: {
        status: "PERMISSION_DENIED",
        message: `${BAIT} ${GOOGLE_PROJECT_NOT_APPROVED_CODE}`,
        details: [
          {
            errors: [{ errorCode: { authorizationError: GOOGLE_PROJECT_NOT_APPROVED_CODE }, message: BAIT }],
          },
        ],
      },
    });
    try {
      const result = await check(ownerToken);
      expect(result.status).toBe(200);
      expectPublicStatus(result.body, "project_not_approved", "project_not_approved", GOOGLE_PROJECT_NOT_APPROVED_MESSAGE);
      expect(calls).toHaveLength(1);
      expect(result.after[0]?.actorId).toBe(ownerId);
      expect(result.after[0]?.payloadJson).toMatchObject({
        allowed: true,
        status: "project_not_approved",
        readiness: "project_not_approved",
        message: GOOGLE_PROJECT_NOT_APPROVED_MESSAGE,
      });
      expectNoSecrets(result.after[0]?.payloadJson);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("returns Ready when list-accessible-customers succeeds and writes an audit row", async () => {
    configureGoogleEnv();
    const account = await seedRealToken(`g3-ok-${Date.now()}`);
    const calls = stubFetch(200, { resourceNames: ["customers/9988776655"] });
    try {
      const result = await check(ownerToken);
      expect(result.status).toBe(200);
      expectPublicStatus(result.body, "ok", "ready", GOOGLE_READY_MESSAGE);
      expect(JSON.stringify(result.body)).not.toContain("9988776655");
      expect(calls).toHaveLength(1);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${ACCESS}`);
      expect(headers.get("developer-token")).toBe(DEV_TOKEN);
      expect(headers.get("login-customer-id")).toBeNull();
      expect(result.after.length).toBe(result.before.length + 1);
      expect(result.after[0]?.actorType).toBe("user");
      expect(result.after[0]?.actorId).toBe(ownerId);
      expectNoSecrets(result.after[0]?.payloadJson);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("hides an unclassified Google failure instead of returning its body", async () => {
    configureGoogleEnv();
    const account = await seedRealToken(`g3-unknown-${Date.now()}`);
    stubFetch(500, { error: { message: BAIT, accessToken: ACCESS } });
    try {
      const result = await check(ownerToken);
      expect(result.status).toBe(200);
      expectPublicStatus(result.body, "unknown", "unknown", GOOGLE_ACCESS_UNKNOWN_MESSAGE);
      expectNoSecrets(result.after[0]?.payloadJson);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });
});

describe("Google sync refuses mock rows for a real token", () => {
  let workspaceId = "";
  let clientId = "";

  beforeAll(async () => {
    const scoped = await ensureScopedUser();
    workspaceId = scoped.workspace.id;
    clientId = scoped.gotDuctless.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  afterAll(async () => {
    restoreEnv();
    await closeDb();
  });

  it("fails with google.not_configured and leaves existing rows in place", async () => {
    clearGoogleEnv();
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "google",
        externalId: `g3-sync-${Date.now()}`,
        displayName: "G3 unconfigured",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "google",
      label: "live",
      tokens: { accessToken: ACCESS, refreshToken: REFRESH, mock: false },
    });
    const [entity] = await getDb()
      .insert(adEntities)
      .values({
        workspaceId,
        clientId,
        adAccountId: account.id,
        platform: "google",
        entityType: "campaign",
        externalId: `kept-${account.id}`,
        name: "Kept campaign",
        status: "enabled",
        rawJson: { source: "live" },
      })
      .returning();
    const before = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("platform call");
    });
    try {
      const result = await runAdAccountSync(account.id);
      expect(result.status).toBe("error");
      expect(result.lastError).toBe("google.not_configured");
      expect(result.entityCount).toBe(0);
      expect(result.mode).not.toBe("mock");
      const stored = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(stored?.connectionStatus).toBe("error");
      expect(stored?.lastError).toBe("google.not_configured");
      const after = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
      expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
      expect(after[0]?.id).toBe(entity.id);
      expect(after[0]?.rawJson).toEqual({ source: "live" });
      expect(fetchMock).not.toHaveBeenCalled();
      expectNoSecrets(result);
      expectNoSecrets(stored?.lastError);
    } finally {
      fetchMock.mockRestore();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });
});
