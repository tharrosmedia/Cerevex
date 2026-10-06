import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_ADS_API_VERSION } from "@tharros/ads-shared";
import { googleAdPlatformConnector, listGoogleAccessibleAccounts } from "@tharros/ads-shared/connectors";
import { oauthConfig } from "@tharros/ads-shared/oauth";
import { workerHealthBody } from "@tharros/ads-shared/worker-health";
import { app } from "./helpers";

const TOKEN = "live-token-not-for-logs";
const CUSTOMER = "1234567890";
const adsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const definitionFile = path.join(adsRoot, "shared/src/google-ads.ts");
const legacyVersionPath = new RegExp(`${"/"}v${"1"}\\d`, "g");
const versionToken = new RegExp(`\\b${GOOGLE_ADS_API_VERSION}\\b`, "g");

type MutationAction = "pause" | "update_budget" | "update_bid" | "add_negative" | "create_ad" | "exclude_placement";

function mutation(action: MutationAction, payload: Record<string, unknown> = {}, entityType = "campaign", externalId = "111") {
  return {
    platform: "google" as const,
    action,
    target: { entityType, externalId, name: "HVAC" },
    payload,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function searchEnvelope(results: unknown[], fieldMask: string) {
  return { results, fieldMask, queryResourceConsumption: "12" };
}

function usesAdsVersion(url: string) {
  const parsed = new URL(url);
  expect(parsed.origin).toBe("https://googleads.googleapis.com");
  expect(parsed.pathname.startsWith(`/${GOOGLE_ADS_API_VERSION}/`)).toBe(true);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next" || entry === "coverage") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs|md|json)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Google Ads API version", () => {
  const previousToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (previousToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previousToken;
  });

  it("allows the version string only in the shared constant and no legacy path", () => {
    const versionHits: { file: string; count: number }[] = [];
    const legacyHits: { file: string; count: number }[] = [];
    for (const file of sourceFiles(adsRoot)) {
      const source = readFileSync(file, "utf8");
      const versionCount = source.match(versionToken)?.length ?? 0;
      const legacyCount = source.match(legacyVersionPath)?.length ?? 0;
      if (versionCount > 0) versionHits.push({ file, count: versionCount });
      if (legacyCount > 0) legacyHits.push({ file, count: legacyCount });
    }
    expect(legacyHits).toEqual([]);
    expect(versionHits).toEqual([{ file: definitionFile, count: 1 }]);
    const source = readFileSync(definitionFile, "utf8");
    expect(source).toContain(`export const GOOGLE_ADS_API_VERSION = "${GOOGLE_ADS_API_VERSION}"`);
  });

  it("reports the Ads API version on ads-api and worker health", async () => {
    const config = oauthConfig();
    expect(config.google.apiVersion).toBe(GOOGLE_ADS_API_VERSION);
    expect(config.google).not.toHaveProperty("clientId");

    const worker = workerHealthBody({ dbOk: true, inngestStatus: "ok", functionIds: ["ads-sync"] });
    expect(worker.oauth.google.apiVersion).toBe(GOOGLE_ADS_API_VERSION);
    expect(JSON.stringify(worker)).not.toContain(TOKEN);

    const res = await app.request("/health");
    const body = (await res.json()) as { oauth: { google: { apiVersion?: string; configured?: boolean } } };
    expect(body.oauth.google.apiVersion).toBe(GOOGLE_ADS_API_VERSION);
    expect(typeof body.oauth.google.configured).toBe("boolean");
    expect(body.oauth.google).not.toHaveProperty("clientId");
    expect(JSON.stringify(body)).not.toContain("googleads.googleapis.com");
  });

  it("lists direct and managed accounts from a versioned search envelope", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push(String(url));
      const parsed = new URL(String(url));
      const body = String(init.body ?? "");
      if (parsed.pathname.endsWith("/customers:listAccessibleCustomers")) {
        return jsonResponse({ resourceNames: ["customers/111", "customers/900"] });
      }
      if (parsed.pathname.endsWith("/customers/111/googleAds:search")) {
        return jsonResponse(searchEnvelope([{
          customer: {
            resourceName: "customers/111",
            id: "111",
            descriptiveName: "Direct Co",
            currencyCode: "USD",
            manager: false,
          },
        }], "customer.id,customer.descriptiveName,customer.currencyCode,customer.manager"));
      }
      if (body.includes("FROM customer ")) {
        return jsonResponse(searchEnvelope([{
          customer: {
            resourceName: "customers/900",
            id: "900",
            descriptiveName: "Agency MCC",
            manager: true,
          },
        }], "customer.id,customer.descriptiveName,customer.currencyCode,customer.manager"));
      }
      return jsonResponse(searchEnvelope([
        {
          customerClient: {
            resourceName: "customers/900/customerClients/222",
            id: "222",
            descriptiveName: "Client A",
            currencyCode: "CAD",
            manager: false,
          },
        },
      ], "customerClient.id,customerClient.descriptiveName,customerClient.currencyCode,customerClient.manager"));
    });

    const accounts = await listGoogleAccessibleAccounts({ accessToken: TOKEN });
    expect(accounts).toEqual([
      { externalId: "111", name: "Direct Co", currency: "USD", detail: null, loginCustomerId: null },
      { externalId: "222", name: "Client A", currency: "CAD", detail: "Managed by Agency MCC", loginCustomerId: "900" },
    ]);
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) usesAdsVersion(url);
  });

  it("pulls campaigns, ad groups, ads, and metrics from a versioned search envelope", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push(String(url));
      const body = String(init.body ?? "");
      if (body.includes("metrics.cost_micros")) {
        if (body.includes("FROM campaign") && body.includes("DURING LAST_7_DAYS")) {
          return jsonResponse(searchEnvelope([{
            campaign: { id: "111" },
            metrics: { costMicros: "10000000", impressions: "1000", clicks: "25", conversions: 2 },
          }], "campaign.id,segments.date,metrics.costMicros,metrics.impressions,metrics.clicks,metrics.conversions"));
        }
        return jsonResponse(searchEnvelope([], "metrics.costMicros"));
      }
      if (body.includes("FROM ad_group_ad")) {
        return jsonResponse(searchEnvelope([{
          adGroupAd: {
            resourceName: `customers/${CUSTOMER}/adGroupAds/220~320`,
            status: "ENABLED",
            ad: { resourceName: `customers/${CUSTOMER}/ads/320`, id: "320", name: "Ad" },
          },
          adGroup: { id: "220" },
          campaign: { id: "111" },
        }], "adGroupAd.ad.id,adGroupAd.ad.name,adGroupAd.status,adGroup.id,campaign.id"));
      }
      if (body.includes("FROM ad_group")) {
        return jsonResponse(searchEnvelope([{
          adGroup: { resourceName: `customers/${CUSTOMER}/adGroups/220`, id: "220", name: "Ad group", status: "PAUSED" },
          campaign: { id: "111" },
        }], "adGroup.id,adGroup.name,adGroup.status,campaign.id"));
      }
      return jsonResponse(searchEnvelope([{
        campaign: {
          resourceName: `customers/${CUSTOMER}/campaigns/111`,
          id: "111",
          name: "Search HVAC",
          status: "ENABLED",
        },
      }], "campaign.id,campaign.name,campaign.status"));
    });

    const pulled = await googleAdPlatformConnector.pull({
      platform: "google",
      externalId: CUSTOMER,
      clientName: "Pilot",
      tokens: { accessToken: TOKEN, mock: false },
      allowLive: true,
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) usesAdsVersion(url);
    expect(calls.every((url) => url.includes(`/customers/${CUSTOMER}/googleAds:search`))).toBe(true);
    expect(pulled.mode).toBe("live");
    expect(pulled.entities.map((row) => ({ type: row.entityType, id: row.externalId, status: row.status }))).toEqual([
      { type: "campaign", id: "111", status: "enabled" },
      { type: "ad_group", id: "220", status: "paused" },
      { type: "ad", id: "320", status: "enabled" },
    ]);
    expect(pulled.metrics).toEqual([
      expect.objectContaining({
        entityExternalId: "111",
        entityType: "campaign",
        window: "7d",
        spendUsd: "10.00",
        impressions: 1000,
        clicks: 25,
        conversions: "2",
      }),
    ]);
  });

  it("writes pause, budget, bid, negative, create, and placement on the shared Ads version", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")) });
      const operation = (JSON.parse(String(init.body ?? "{}")) as { mutateOperations?: Record<string, unknown>[] })
        .mutateOperations?.[0] ?? {};
      const result = "campaignOperation" in operation
        ? { campaignResult: { resourceName: `customers/${CUSTOMER}/campaigns/111` } }
        : "campaignBudgetOperation" in operation
          ? { campaignBudgetResult: { resourceName: `customers/${CUSTOMER}/campaignBudgets/111` } }
          : "adGroupOperation" in operation
            ? { adGroupResult: { resourceName: `customers/${CUSTOMER}/adGroups/220` } }
            : "adGroupAdOperation" in operation
              ? { adGroupAdResult: { resourceName: `customers/${CUSTOMER}/adGroupAds/220~321` } }
              : { campaignCriterionResult: { resourceName: `customers/${CUSTOMER}/campaignCriteria/111~1` } };
      return jsonResponse({ mutateOperationResponses: [result] });
    });

    const tokens = { accessToken: TOKEN, mock: false };
    const campaignLive = {
      externalId: "111",
      entityType: "campaign",
      status: "enabled",
      dailyBudget: 50,
      budgetNative: "50000000",
      currency: "USD",
    };
    const bidLive = {
      externalId: "220",
      entityType: "ad_group",
      status: "enabled",
      bidAmount: 2,
      bidNative: "2000000",
      currency: "USD",
    };

    const paused = await googleAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("pause"),
      live: campaignLive,
      accountExternalId: CUSTOMER,
    });
    const budget = await googleAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("update_budget", { amount: 40 }),
      live: campaignLive,
      accountExternalId: CUSTOMER,
    });
    const bid = await googleAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("update_bid", { amount: 1.5 }, "ad_group", "220"),
      live: bidLive,
      accountExternalId: CUSTOMER,
    });
    const negative = await googleAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("add_negative", { text: "free install" }),
      live: null,
      accountExternalId: CUSTOMER,
    });
    const created = await googleAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("create_ad", { headline: "Same-week visit", body: "Book a tech." }, "ad_group", "220"),
      live: null,
      accountExternalId: CUSTOMER,
    });
    const placement = await googleAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("exclude_placement", { placement: "example.com" }),
      live: null,
      accountExternalId: CUSTOMER,
    });

    expect(paused).toMatchObject({ status: "applied", writes: true });
    expect(budget).toMatchObject({ status: "applied", writes: true });
    expect(bid).toMatchObject({ status: "applied", writes: true });
    expect(negative).toMatchObject({ status: "applied", writes: true });
    expect(created).toMatchObject({ status: "applied", writes: true });
    expect(placement).toMatchObject({ status: "applied", writes: true });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      `/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`,
      `/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`,
      `/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`,
      `/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`,
      `/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`,
      `/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`,
    ]);
    expect(calls[0].body).toEqual({
      mutateOperations: [{
        campaignOperation: {
          update: { resourceName: `customers/${CUSTOMER}/campaigns/111`, status: "PAUSED" },
          updateMask: "status",
        },
      }],
    });
    expect(calls[1].body).toEqual({
      mutateOperations: [{
        campaignBudgetOperation: {
          update: { resourceName: `customers/${CUSTOMER}/campaignBudgets/111`, amountMicros: "40000000" },
          updateMask: "amount_micros",
        },
      }],
    });
    expect(calls[2].body).toEqual({
      mutateOperations: [{
        adGroupOperation: {
          update: { resourceName: `customers/${CUSTOMER}/adGroups/220`, cpcBidMicros: "1500000" },
          updateMask: "cpc_bid_micros",
        },
      }],
    });
    expect(calls[3].body).toEqual({
      mutateOperations: [{
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${CUSTOMER}/campaigns/111`,
            negative: true,
            keyword: { text: "free install", matchType: "PHRASE" },
          },
        },
      }],
    });
    expect(calls[4].body).toEqual({
      mutateOperations: [{
        adGroupAdOperation: {
          create: {
            adGroup: `customers/${CUSTOMER}/adGroups/220`,
            status: "PAUSED",
            ad: {
              responsiveSearchAd: {
                headlines: [{ text: "Same-week visit" }],
                descriptions: [{ text: "Book a tech." }],
              },
            },
          },
        },
      }],
    });
    expect(calls[5].body).toEqual({
      mutateOperations: [{
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${CUSTOMER}/campaigns/111`,
            negative: true,
            placement: { url: "example.com" },
          },
        },
      }],
    });
    for (const call of calls) usesAdsVersion(call.url);
  });
});
