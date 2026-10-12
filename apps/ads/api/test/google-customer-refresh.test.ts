import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { connectionStatusLabel, defaultCapabilityFlags } from "@tharros/ads-shared";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import {
  GOOGLE_CONFIG_ERROR,
  GOOGLE_PARTIAL_PULL,
  GOOGLE_RATE_LIMITED,
  GOOGLE_REFRESH_REJECTED,
  GOOGLE_RECONNECT_REQUIRED,
  GoogleOAuthConfigError,
  GoogleRefreshRejected,
  GoogleRetryLater,
  googleAdPlatformConnector,
  googleAdsHeaders,
} from "@tharros/ads-shared/connectors";
import { loadTokens, storeTokens } from "@tharros/ads-shared/credentials";
import { executeMutation } from "@tharros/ads-shared/mutate";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { adAccounts, adEntities, auditLog } from "@tharros/ads-shared/schema";
import { toPublicAccount } from "../src/connect";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const ACCESS = "g4-access-token-value";
const NEXT_ACCESS = "g4-next-access-token-value";
const REFRESH = "g4-refresh-token-value";
const CLIENT_SECRET = "g4-client-secret-value";
const DECOY_MANAGER = "0009998888";
const ENV_MANAGER = "GOOGLE_ADS_LOGIN_CUSTOMER_ID";

type Call = { url: string; headers: Record<string, string>; body?: string };

function headersOf(init: RequestInit): Record<string, string> {
  const headers = init.headers;
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function spyConsole() {
  const calls: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
  }
  return calls;
}

function assertNoSecrets(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text).not.toContain(ACCESS);
  expect(text).not.toContain(NEXT_ACCESS);
  expect(text).not.toContain(REFRESH);
  expect(text).not.toContain(CLIENT_SECRET);
}

function tsSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "test" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsSources(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const pause = {
  platform: "google" as const,
  action: "pause" as const,
  target: { entityType: "campaign", externalId: "campaign-1", name: "HVAC" },
  payload: {},
};

describe("Google customer id and honest refresh", () => {
  const previous: Record<string, string | undefined> = {};
  let ownerReady = false;
  let clientId = "";
  let workspaceId = "";

  beforeAll(async () => {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", ENV_MANAGER]) {
      previous[key] = process.env[key];
    }
    await ensureScopedUser();
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    const clients = (
      await json(await app.request("/clients", { headers: { authorization: `Bearer ${owner.token}` } }))
    ).clients as { id: string; name: string; workspaceId: string }[];
    const got = clients.find((row) => row.name === "Got Ductless");
    if (!got) throw new Error("Seed client missing");
    clientId = got.id;
    workspaceId = got.workspaceId;
    ownerReady = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterAll(async () => {
    await closeDb();
  });

  function configureGoogle() {
    process.env.GOOGLE_CLIENT_ID = "g4-client-id";
    process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    process.env[ENV_MANAGER] = `000-999-8888`;
  }

  async function seedAccount(input: { externalId: string; loginCustomerId?: string | null; expiresAt?: string }) {
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "google",
        externalId: input.externalId,
        displayName: "G4 google",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "google",
      label: "live",
      tokens: {
        accessToken: ACCESS,
        refreshToken: REFRESH,
        expiresAt: input.expiresAt,
        loginCustomerId: input.loginCustomerId ?? undefined,
        mock: false,
      },
    });
    return account;
  }

  async function reconnectAudits(adAccountId: string) {
    const rows = await getDb().select().from(auditLog).where(eq(auditLog.entityId, adAccountId));
    return rows.filter((row) => row.action === GOOGLE_RECONNECT_REQUIRED);
  }

  it("does not read a process-wide manager id from production code", () => {
    const roots = [
      join(import.meta.dirname, "../../../ads/shared/src"),
      join(import.meta.dirname, "../src"),
      join(import.meta.dirname, "../../workers/src"),
      join(import.meta.dirname, "../../../../jobs/ads"),
    ];
    const hits = roots.flatMap(tsSources).filter((path) => readFileSync(path, "utf8").includes(ENV_MANAGER));
    expect(hits).toEqual([]);
  });

  it("sends each account's customer id and its own manager id, and ignores the env value", async () => {
    configureGoogle();
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const call = { url: String(url), headers: headersOf(init), body: typeof init.body === "string" ? init.body : undefined };
      calls.push(call);
      if (call.url.includes("googleAds:mutate")) return jsonResponse({ mutateOperationResponses: [{}] });
      if (call.body?.includes("LIMIT 50")) {
        return jsonResponse({ results: [{ campaign: { id: "campaign-1", name: "HVAC", status: "ENABLED" } }] });
      }
      if (call.body?.includes("campaign_budget.amount_micros")) {
        return jsonResponse({
          results: [{ campaign: { status: "ENABLED" }, campaignBudget: { amountMicros: "1000000" }, customer: { currencyCode: "USD" } }],
        });
      }
      return jsonResponse({ results: [] });
    });

    const accounts = [
      { externalId: "customers/1010101010", loginCustomerId: "111-222-3333", managerHeader: "1112223333" },
      { externalId: "customers/2020202020", loginCustomerId: "4445556666", managerHeader: "4445556666" },
      { externalId: "customers/3030303030", loginCustomerId: null, managerHeader: undefined },
    ] as const;

    for (const account of accounts) {
      const tokens = {
        accessToken: ACCESS,
        mock: false as const,
        ...(account.loginCustomerId ? { loginCustomerId: account.loginCustomerId } : {}),
      };
      await googleAdPlatformConnector.pull({
        platform: "google",
        tokens,
        externalId: account.externalId,
        clientName: "Pilot",
        allowLive: true,
      });
      await googleAdPlatformConnector.readLiveEntityState({
        tokens,
        mutation: pause,
        accountExternalId: account.externalId,
      });
      await googleAdPlatformConnector.applyLive({
        tokens,
        mutation: pause,
        live: null,
        accountExternalId: account.externalId,
      });
      const mine = calls.splice(0);
      expect(mine.length).toBeGreaterThan(0);
      for (const call of mine) {
        expect(call.url).toContain(`/customers/${account.externalId.replace(/^customers\//, "")}/`);
        expect(call.url).not.toContain(DECOY_MANAGER);
        if (account.managerHeader) expect(call.headers["login-customer-id"]).toBe(account.managerHeader);
        else expect(call.headers["login-customer-id"]).toBeUndefined();
        expect(call.headers["login-customer-id"]).not.toBe(DECOY_MANAGER);
      }
    }

    expect(googleAdsHeaders({ accessToken: ACCESS }, null)["login-customer-id"]).toBeUndefined();
    expect(googleAdsHeaders({ accessToken: ACCESS, loginCustomerId: "111-222-3333" }, null)["login-customer-id"]).toBe(
      "1112223333",
    );
  });

  it("refuses a live re-read when the account customer id is missing", async () => {
    configureGoogle();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const live = await googleAdPlatformConnector.readLiveEntityState({ tokens: { accessToken: ACCESS }, mutation: pause });
    expect(live).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a rejected refresh instead of returning the old token", async () => {
    configureGoogle();
    const logs = spyConsole();
    const leaked = `invalid_grant leaked ${REFRESH} secret ${CLIENT_SECRET}`;
    vi.stubGlobal("fetch", async () => jsonResponse({ error: "invalid_grant", error_description: leaked }, 400));
    const stored = { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    await expect(googleAdPlatformConnector.refreshTokens(stored)).rejects.toBeInstanceOf(GoogleRefreshRejected);
    await expect(googleAdPlatformConnector.refreshTokens(stored)).rejects.toThrow(GOOGLE_REFRESH_REJECTED);
    assertNoSecrets(logs);
  });

  it("retries a 429 or 5xx refresh and does not treat either as a rejected grant", async () => {
    configureGoogle();
    const logs = spyConsole();
    const leaked = `slow down ${REFRESH}`;
    vi.stubGlobal("fetch", async () => new Response(leaked, { status: 429 }));
    await expect(
      googleAdPlatformConnector.refreshTokens({ accessToken: ACCESS, refreshToken: REFRESH }),
    ).rejects.toBeInstanceOf(GoogleRetryLater);
    await expect(
      googleAdPlatformConnector.refreshTokens({ accessToken: ACCESS, refreshToken: REFRESH }),
    ).rejects.toThrow(GOOGLE_RATE_LIMITED);

    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: leaked }), { status: 503 }),
    );
    await expect(
      googleAdPlatformConnector.refreshTokens({ accessToken: ACCESS, refreshToken: REFRESH }),
    ).rejects.toBeInstanceOf(GoogleRetryLater);
    assertNoSecrets(logs);
  });

  it.each(["invalid_client", "unauthorized_client", "invalid_request"] as const)(
    "treats %s as a retryable config error and does not mark reconnect",
    async (oauthError) => {
      expect(ownerReady).toBe(true);
      configureGoogle();
      const logs = spyConsole();
      const leaked = `${oauthError} leaked ${REFRESH} secret ${CLIENT_SECRET}`;
      vi.stubGlobal("fetch", async () => jsonResponse({ error: oauthError, error_description: leaked }, 400));
      const stored = { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: new Date(Date.now() - 60_000).toISOString() };
      const rejected = googleAdPlatformConnector.refreshTokens(stored);
      await expect(rejected).rejects.toBeInstanceOf(GoogleOAuthConfigError);
      await expect(rejected).rejects.not.toBeInstanceOf(GoogleRefreshRejected);
      await expect(googleAdPlatformConnector.refreshTokens(stored)).rejects.toMatchObject({
        message: GOOGLE_CONFIG_ERROR,
        oauthError,
      });
      expect(JSON.stringify(logs)).toContain(oauthError);
      assertNoSecrets(logs);

      const account = await seedAccount({
        externalId: `customers/g4cfg${oauthError}${Date.now()}`,
        loginCustomerId: "111-222-3333",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      try {
        await expect(runAdAccountSync(account.id)).rejects.toBeInstanceOf(GoogleOAuthConfigError);
        const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
        expect(row?.connectionStatus).toBe("error");
        expect(row?.connectionStatus).not.toBe("needs_reconnect");
        expect(row?.lastError).toBe(GOOGLE_CONFIG_ERROR);
        expect(connectionStatusLabel(toPublicAccount(row!, await loadTokens(account.id)).connectionStatus)).toBe("Error");
        expect(await reconnectAudits(account.id)).toHaveLength(0);
        assertNoSecrets(row?.lastError);
        assertNoSecrets(logs);
      } finally {
        await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
      }
    },
  );

  it("syncs again after a config error once the token endpoint accepts the secret", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    let repaired = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const callUrl = String(url);
      if (callUrl.includes("oauth2.googleapis.com/token")) {
        if (!repaired) {
          return jsonResponse(
            { error: "invalid_client", error_description: `bad secret ${CLIENT_SECRET} ${REFRESH}` },
            401,
          );
        }
        return jsonResponse({ access_token: NEXT_ACCESS, expires_in: 3600, refresh_token: REFRESH });
      }
      const body = typeof init.body === "string" ? init.body : "";
      expect(headersOf(init).authorization).toBe(`Bearer ${NEXT_ACCESS}`);
      if (body.includes("LIMIT 50")) {
        return jsonResponse({ results: [{ campaign: { id: "campaign-1", name: "HVAC", status: "ENABLED" } }] });
      }
      return jsonResponse({ results: [] });
    });
    const account = await seedAccount({
      externalId: `customers/g4fix${Date.now()}`,
      loginCustomerId: "111-222-3333",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      await expect(runAdAccountSync(account.id)).rejects.toBeInstanceOf(GoogleOAuthConfigError);
      repaired = true;
      const second = await runAdAccountSync(account.id);
      expect(second.status).toBe("connected");
      expect(second.lastError).toBeNull();
      const stored = await loadTokens(account.id);
      expect(stored?.accessToken).toBe(NEXT_ACCESS);
      expect(stored?.refreshToken).toBe(REFRESH);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("connected");
      expect(row?.lastError).toBeNull();
      expect(await reconnectAudits(account.id)).toHaveLength(0);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("does not treat another token-endpoint 4xx as a revoked grant", async () => {
    configureGoogle();
    const logs = spyConsole();
    vi.stubGlobal(
      "fetch",
      async () => jsonResponse({ error: "invalid_scope", error_description: `scope ${REFRESH} ${CLIENT_SECRET}` }, 400),
    );
    const failure = googleAdPlatformConnector.refreshTokens({ accessToken: ACCESS, refreshToken: REFRESH });
    await expect(failure).rejects.toBeInstanceOf(GoogleOAuthConfigError);
    await expect(failure).rejects.not.toBeInstanceOf(GoogleRefreshRejected);
    expect(JSON.stringify(logs)).toContain("invalid_scope");
    assertNoSecrets(logs);
  });

  it("treats a token response with no access token as a provider error", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    const leaked = `empty body ${REFRESH} ${CLIENT_SECRET}`;
    vi.stubGlobal("fetch", async () => jsonResponse({ token_type: "Bearer", error_description: leaked }));
    const stored = { accessToken: ACCESS, refreshToken: REFRESH };
    await expect(googleAdPlatformConnector.refreshTokens(stored)).rejects.toBeInstanceOf(GoogleRetryLater);
    await expect(googleAdPlatformConnector.refreshTokens(stored)).rejects.not.toBeInstanceOf(GoogleRefreshRejected);
    expect(JSON.stringify(logs)).toContain("empty_access_token");
    assertNoSecrets(logs);

    const account = await seedAccount({
      externalId: `customers/g4empty${Date.now()}`,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      await expect(runAdAccountSync(account.id)).rejects.toBeInstanceOf(GoogleRetryLater);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(row?.lastError).not.toBe(GOOGLE_REFRESH_REJECTED);
      expect(row?.lastError).not.toBe(GOOGLE_CONFIG_ERROR);
      expect(await reconnectAudits(account.id)).toHaveLength(0);
      assertNoSecrets(row?.lastError);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("does not treat a token-endpoint network error as a revoked grant", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError(`network down ${REFRESH} ${CLIENT_SECRET}`);
    });
    await expect(
      googleAdPlatformConnector.refreshTokens({ accessToken: ACCESS, refreshToken: REFRESH }),
    ).rejects.toBeInstanceOf(GoogleRetryLater);
    await expect(
      googleAdPlatformConnector.refreshTokens({ accessToken: ACCESS, refreshToken: REFRESH }),
    ).rejects.not.toBeInstanceOf(GoogleRefreshRejected);

    const account = await seedAccount({
      externalId: `customers/g4net${Date.now()}`,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      await expect(runAdAccountSync(account.id)).rejects.toBeInstanceOf(GoogleRetryLater);
      await expect(runAdAccountSync(account.id)).rejects.not.toBeInstanceOf(GoogleRefreshRejected);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(row?.lastError).not.toBe(GOOGLE_REFRESH_REJECTED);
      expect(await reconnectAudits(account.id)).toHaveLength(0);
      assertNoSecrets(row?.lastError);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("marks invalid_grant as Needs reconnect once and does not call Google again", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    let tokenCalls = 0;
    vi.stubGlobal("fetch", async () => {
      tokenCalls += 1;
      return jsonResponse({ error: "invalid_grant", error_description: `revoked ${REFRESH} ${CLIENT_SECRET}` }, 400);
    });
    const account = await seedAccount({
      externalId: `customers/g4rej${Date.now()}`,
      loginCustomerId: "111-222-3333",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      const first = await runAdAccountSync(account.id);
      expect(first.status).toBe("error");
      expect(first.lastError).toBe(GOOGLE_REFRESH_REJECTED);
      expect(tokenCalls).toBe(1);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("needs_reconnect");
      expect(row?.lastError).toBe(GOOGLE_REFRESH_REJECTED);
      expect(connectionStatusLabel(toPublicAccount(row!, await loadTokens(account.id)).connectionStatus)).toBe(
        "Needs reconnect",
      );
      const audits = await reconnectAudits(account.id);
      expect(audits).toHaveLength(1);
      assertNoSecrets(audits[0]?.payloadJson);
      assertNoSecrets(first.lastError);

      const second = await runAdAccountSync(account.id);
      expect(second.lastError).toBe(GOOGLE_REFRESH_REJECTED);
      expect(tokenCalls).toBe(1);
      expect(await reconnectAudits(account.id)).toHaveLength(1);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("refreshes an expired access token before apply and stores the new token", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const call = { url: String(url), headers: headersOf(init), body: typeof init.body === "string" ? init.body : undefined };
      calls.push(call);
      if (call.url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: NEXT_ACCESS, expires_in: 3600 });
      }
      expect(call.headers.authorization).toBe(`Bearer ${NEXT_ACCESS}`);
      expect(call.headers["login-customer-id"]).toBe("1112223333");
      expect(call.url).toContain("/customers/4141414141/");
      expect(call.url).not.toContain(DECOY_MANAGER);
      if (call.url.includes("googleAds:mutate")) return jsonResponse({ mutateOperationResponses: [{}] });
      if (call.body?.includes("campaign_budget.amount_micros")) {
        return jsonResponse({
          results: [{ campaign: { status: "ENABLED" }, campaignBudget: { amountMicros: "1000000" }, customer: { currencyCode: "USD" } }],
        });
      }
      return jsonResponse({ results: [] });
    });
    const account = await seedAccount({
      externalId: "customers/4141414141",
      loginCustomerId: "111-222-3333",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const [entity] = await getDb()
      .insert(adEntities)
      .values({
        workspaceId,
        clientId,
        adAccountId: account.id,
        platform: "google",
        entityType: "campaign",
        externalId: "campaign-1",
        name: "HVAC",
        status: "enabled",
        rawJson: {},
      })
      .returning();
    try {
      const outcome = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation: {
          platform: "google",
          action: "pause",
          target: { entityType: "campaign", externalId: entity.externalId, name: entity.name },
          payload: {},
        },
        capabilities: defaultCapabilityFlags(),
      });
      expect(outcome.status).toBe("applied");
      expect(outcome.writes).toBe(true);
      expect(calls[0]?.url).toContain("oauth2.googleapis.com/token");
      expect(calls.slice(1).every((call) => call.headers.authorization === `Bearer ${NEXT_ACCESS}`)).toBe(true);
      const stored = await loadTokens(account.id);
      expect(stored?.accessToken).toBe(NEXT_ACCESS);
      expect(stored?.refreshToken).toBe(REFRESH);
      expect(stored?.loginCustomerId).toBe("111-222-3333");
      expect(stored?.expiresAt).not.toBe(new Date(Date.now() - 60_000).toISOString());
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      assertNoSecrets(outcome);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("stops apply on invalid_grant with one audit row and no second Google call", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return jsonResponse({ error: "invalid_grant", error_description: REFRESH }, 400);
    });
    const account = await seedAccount({
      externalId: `customers/g4apply${Date.now()}`,
      loginCustomerId: "4445556666",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      const mutation = {
        platform: "google" as const,
        action: "pause" as const,
        target: { entityType: "campaign", externalId: "campaign-1", name: "HVAC" },
        payload: {},
      };
      const first = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation,
        capabilities: defaultCapabilityFlags(),
      });
      expect(first.status).toBe("failed");
      expect(first.writes).toBe(false);
      expect(first.reason).toBe(GOOGLE_REFRESH_REJECTED);
      expect(calls).toBe(1);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(connectionStatusLabel(toPublicAccount(row!, await loadTokens(account.id)).connectionStatus)).toBe(
        "Needs reconnect",
      );
      expect(await reconnectAudits(account.id)).toHaveLength(1);
      const second = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation,
        capabilities: defaultCapabilityFlags(),
      });
      expect(second.reason).toBe(GOOGLE_REFRESH_REJECTED);
      expect(calls).toBe(1);
      expect(await reconnectAudits(account.id)).toHaveLength(1);
      assertNoSecrets(first);
      assertNoSecrets(second);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it.each([429, 503] as const)("does not mark reconnect when refresh returns %s", async (status) => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    vi.stubGlobal("fetch", async () => new Response(`busy ${REFRESH}`, { status }));
    const account = await seedAccount({
      externalId: `customers/g4retry${status}${Date.now()}`,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      await expect(runAdAccountSync(account.id)).rejects.toBeInstanceOf(GoogleRetryLater);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(row?.lastError).not.toBe(GOOGLE_REFRESH_REJECTED);
      if (status === 429) expect(row?.lastError).toBe(GOOGLE_RATE_LIMITED);
      else expect(row?.lastError).toBeNull();
      expect(await reconnectAudits(account.id)).toHaveLength(0);
      assertNoSecrets(row?.lastError);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("labels a partial pull and still keeps the campaigns", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? init.body : "";
      const headers = headersOf(init);
      expect(String(url)).toContain("/customers/5151515151/");
      expect(headers["login-customer-id"]).toBe("4445556666");
      expect(headers["login-customer-id"]).not.toBe(DECOY_MANAGER);
      if (body.includes("LIMIT 50")) {
        return jsonResponse({ results: [{ campaign: { id: "campaign-1", name: "HVAC", status: "ENABLED" } }] });
      }
      return new Response(`metrics failed ${REFRESH}`, { status: 500 });
    });
    const account = await seedAccount({
      externalId: "customers/5151515151",
      loginCustomerId: "4445556666",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    try {
      const result = await runAdAccountSync(account.id);
      expect(result.status).toBe("connected");
      expect(result.lastError).toBe(GOOGLE_PARTIAL_PULL);
      expect(result.entityCount).toBe(1);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("connected");
      expect(row?.lastError).toBe(GOOGLE_PARTIAL_PULL);
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      const entities = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
      expect(entities.map((entity) => entity.externalId)).toEqual(["campaign-1"]);
      expect(await reconnectAudits(account.id)).toHaveLength(0);
      assertNoSecrets(result.lastError);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("retries a rate-limited campaign read and does not store a plain success", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    vi.stubGlobal("fetch", async () => new Response(`limited ${REFRESH}`, { status: 429 }));
    const account = await seedAccount({
      externalId: "customers/6161616161",
      loginCustomerId: "1112223333",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    try {
      await expect(runAdAccountSync(account.id)).rejects.toThrow(GOOGLE_RATE_LIMITED);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(row?.lastError).toBe(GOOGLE_RATE_LIMITED);
      const entities = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
      expect(entities).toHaveLength(0);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("writes one reconnect audit when five invalid_grant syncs run together", async () => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ error: "invalid_grant", error_description: `revoked ${REFRESH} ${CLIENT_SECRET}` }, 400),
    );
    const account = await seedAccount({
      externalId: `customers/g4race${Date.now()}`,
      loginCustomerId: "111-222-3333",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      const results = await Promise.all(Array.from({ length: 5 }, () => runAdAccountSync(account.id)));
      expect(results.every((result) => result.lastError === GOOGLE_REFRESH_REJECTED)).toBe(true);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("needs_reconnect");
      expect(await reconnectAudits(account.id)).toHaveLength(1);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it.each([429, 503] as const)("blocks the mutate when the pre-write live read returns %s", async (status) => {
    expect(ownerReady).toBe(true);
    configureGoogle();
    const logs = spyConsole();
    let mutateCalls = 0;
    let searchCalls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const callUrl = String(url);
      if (callUrl.includes("oauth2.googleapis.com/token")) {
        throw new Error("refresh should not run before a fresh token");
      }
      if (callUrl.includes("googleAds:mutate")) {
        mutateCalls += 1;
        return jsonResponse({ mutateOperationResponses: [{}] });
      }
      searchCalls += 1;
      return new Response(`read failed ${REFRESH}`, { status });
    });
    const account = await seedAccount({
      externalId: `customers/g4read${status}${Date.now()}`,
      loginCustomerId: "111-222-3333",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    try {
      const outcome = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation: pause,
        capabilities: defaultCapabilityFlags(),
      });
      expect(searchCalls).toBe(1);
      expect(mutateCalls).toBe(0);
      expect(outcome.status).toBe("failed");
      expect(outcome.writes).toBe(false);
      expect(outcome.reason).toBe(status === 429 ? GOOGLE_RATE_LIMITED : "Google didn't answer. Cerevex will try again later.");
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(await reconnectAudits(account.id)).toHaveLength(0);
      assertNoSecrets(outcome);
      assertNoSecrets(logs);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });
});
