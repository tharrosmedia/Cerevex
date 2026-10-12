import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAdsDeveloperToken, optionalEnv } from "@tharros/ads-shared/env";
import { googleAdPlatformConnector, googleAdsHeaders, listGoogleAccessibleAccounts } from "@tharros/ads-shared/connectors";

const ACCESS = "g2-access-token-not-for-logs";
const SECRET = "g2-developer-token-not-for-logs";
const TOKEN_ENV = "GOOGLE_ADS_DEVELOPER_TOKEN";
const LOGIN_ENV = "GOOGLE_ADS_LOGIN_CUSTOMER_ID";

type Call = { url: string; headers: Record<string, string>; body?: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headersOf(init: RequestInit): Record<string, string> {
  const headers = init.headers;
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function stubFetch(status = 200, errorBody = "rejected") {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      headers: headersOf(init),
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    if (status !== 200) return new Response(errorBody, { status, headers: { "content-type": "text/plain" } });
    if (call.url.includes("listAccessibleCustomers")) return jsonResponse({ resourceNames: ["customers/111"] });
    if (call.url.includes("googleAds:mutate")) return jsonResponse({ mutateOperationResponses: [{}] });
    if (call.body?.includes("FROM customer ")) {
      return jsonResponse({
        results: [{ customer: { id: "111", descriptiveName: "Direct", currencyCode: "USD", manager: false } }],
      });
    }
    if (call.body?.includes("campaign_budget.amount_micros")) {
      return jsonResponse({
        results: [
          {
            campaign: { status: "ENABLED" },
            campaignBudget: { amountMicros: "50000000" },
            customer: { currencyCode: "USD" },
          },
        ],
      });
    }
    return jsonResponse({ results: [] });
  });
  return calls;
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

function kind(call: Call): "list" | "pull" | "reread" | "mutate" | "other" {
  if (call.url.includes("listAccessibleCustomers")) return "list";
  if (call.url.includes("googleAds:mutate")) return "mutate";
  if (call.body?.includes("campaign_budget.amount_micros")) return "reread";
  if (call.body?.includes("LIMIT 50")) return "pull";
  return "other";
}

function expectPaths(calls: Call[]) {
  const kinds = new Set(calls.map(kind));
  expect(kinds.has("list")).toBe(true);
  expect(kinds.has("pull")).toBe(true);
  expect(kinds.has("reread")).toBe(true);
  expect(kinds.has("mutate")).toBe(true);
}

function expectNoSecret(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(ACCESS);
}

function expectNoSecretInTransport(calls: Call[]) {
  for (const call of calls) {
    expect(call.url).not.toContain(SECRET);
    expect(call.url).not.toContain(ACCESS);
    expect(call.body ?? "").not.toContain(SECRET);
    expect(call.body ?? "").not.toContain(ACCESS);
  }
}

const tokens = { accessToken: ACCESS, mock: false as const };
const rereadMutation = {
  platform: "google" as const,
  action: "pause" as const,
  target: { entityType: "campaign", externalId: "customers/555/campaigns/111", name: "HVAC" },
  payload: {},
};
const mutateMutation = {
  platform: "google" as const,
  action: "pause" as const,
  target: { entityType: "campaign", externalId: "111", name: "HVAC" },
  payload: {},
};

async function exercise() {
  const accounts = await listGoogleAccessibleAccounts(tokens);
  const pulled = await googleAdPlatformConnector.pull({
    platform: "google",
    externalId: "555",
    clientName: "Pilot",
    tokens,
    allowLive: true,
  });
  const live = await googleAdPlatformConnector.readLiveEntityState({
    tokens,
    mutation: rereadMutation,
  });
  const outcome = await googleAdPlatformConnector.applyLive({
    tokens,
    mutation: mutateMutation,
    live: null,
    accountExternalId: "555",
  });
  return { accounts, pulled, live, outcome };
}

describe("Google Ads developer token", () => {
  const previousToken = process.env[TOKEN_ENV];
  const previousLogin = process.env[LOGIN_ENV];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (previousToken === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = previousToken;
    if (previousLogin === undefined) delete process.env[LOGIN_ENV];
    else process.env[LOGIN_ENV] = previousLogin;
  });

  it("treats an unset, empty, or whitespace token as absent", () => {
    delete process.env[TOKEN_ENV];
    expect(optionalEnv(TOKEN_ENV)).toBeUndefined();
    expect(googleAdsDeveloperToken()).toBeUndefined();
    process.env[TOKEN_ENV] = "";
    expect(googleAdsDeveloperToken()).toBeUndefined();
    process.env[TOKEN_ENV] = " \n\t ";
    expect(googleAdsDeveloperToken()).toBeUndefined();
    process.env[TOKEN_ENV] = `  ${SECRET}  `;
    expect(googleAdsDeveloperToken()).toBe(SECRET);
    expect(() => googleAdsDeveloperToken()).not.toThrow();
  });

  it("omits developer-token from headers unless a non-blank token is supplied", () => {
    expect(googleAdsHeaders({ accessToken: ACCESS })["developer-token"]).toBeUndefined();
    expect(googleAdsHeaders({ accessToken: ACCESS }, "")["developer-token"]).toBeUndefined();
    expect(googleAdsHeaders({ accessToken: ACCESS }, " \n ")["developer-token"]).toBeUndefined();
    expect(googleAdsHeaders({ accessToken: ACCESS }, `  ${SECRET}  `)["developer-token"]).toBe(SECRET);
  });

  it("does not send developer-token or throw when the token is unset, empty, or whitespace", async () => {
    for (const raw of [undefined, "", " \n\t "] as const) {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      if (raw === undefined) delete process.env[TOKEN_ENV];
      else process.env[TOKEN_ENV] = raw;
      delete process.env[LOGIN_ENV];
      const calls = stubFetch();
      const logs = spyConsole();
      const result = await exercise();
      expectPaths(calls);
      for (const call of calls) expect(call.headers["developer-token"]).toBeUndefined();
      expectNoSecretInTransport(calls);
      expectNoSecret(result);
      expectNoSecret(logs);
      expect(result.pulled.mode).toBe("live");
      expect(result.live?.status).toBe("enabled");
      expect(result.outcome).toMatchObject({ status: "applied", writes: true, mode: "live" });
    }
  });

  it("sends developer-token on list, pull, re-read, and mutate when the token is set", async () => {
    process.env[TOKEN_ENV] = `  ${SECRET}  `;
    delete process.env[LOGIN_ENV];
    const calls = stubFetch();
    const logs = spyConsole();
    const result = await exercise();
    expectPaths(calls);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.headers["developer-token"]).toBe(SECRET);
    expectNoSecretInTransport(calls);
    expectNoSecret(result);
    expectNoSecret(logs);
    expect(result.outcome).toMatchObject({ status: "applied", writes: true });
  });

  it("reports a platform failure without the token and without a missing-token block", async () => {
    for (const raw of [undefined, SECRET] as const) {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      if (raw === undefined) delete process.env[TOKEN_ENV];
      else process.env[TOKEN_ENV] = raw;
      delete process.env[LOGIN_ENV];
      const calls = stubFetch(400);
      const logs = spyConsole();
      await expect(listGoogleAccessibleAccounts(tokens)).rejects.toThrow("Google Ads account list failed (400)");
      await expect(
        googleAdPlatformConnector.pull({
          platform: "google",
          externalId: "555",
          clientName: "Pilot",
          tokens,
          allowLive: true,
        }),
      ).rejects.toThrow("Google Ads read failed (400)");
      await expect(
        googleAdPlatformConnector.readLiveEntityState({ tokens, mutation: rereadMutation }),
      ).resolves.toBeNull();
      await expect(
        googleAdPlatformConnector.applyLive({
          tokens,
          mutation: mutateMutation,
          live: null,
          accountExternalId: "555",
        }),
      ).rejects.toThrow("Google Ads write failed (400): rejected");
      expectPaths(calls);
      for (const call of calls) {
        expect(call.url).not.toContain(SECRET);
        expect(call.url).not.toContain(ACCESS);
        if (raw === undefined) expect(call.headers["developer-token"]).toBeUndefined();
        else expect(call.headers["developer-token"]).toBe(SECRET);
      }
      expect(JSON.stringify(logs)).not.toContain(SECRET);
      expect(JSON.stringify(logs)).not.toContain(ACCESS);
    }
  });
});
