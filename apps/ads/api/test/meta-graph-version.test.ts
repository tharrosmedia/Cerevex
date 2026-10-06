import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { META_GRAPH_VERSION } from "@tharros/ads-shared";
import { metaAdPlatformConnector } from "@tharros/ads-shared/connectors";
import { metaAuthorizeUrl, oauthConfig } from "@tharros/ads-shared/oauth";
import { workerHealthBody } from "@tharros/ads-shared/worker-health";
import { app } from "./helpers";

const TOKEN = "live-token-not-for-logs";
const adsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const definitionFile = path.join(adsRoot, "shared/src/meta-graph.ts");
const versionLiteral = /v2\d\.0/g;

type MutationAction = "pause" | "update_budget" | "update_bid" | "create_ad" | "exclude_placement";

function mutation(
  action: MutationAction,
  payload: Record<string, unknown> = {},
  entityType = "campaign",
  externalId = "238",
) {
  return {
    platform: "meta" as const,
    action,
    target: { entityType, externalId, name: "HVAC" },
    payload,
  };
}

function jsonResponse(body: unknown, warning?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (warning) headers.set("X-Ad-Api-Version-Warning", warning);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function usesGraphVersion(url: string) {
  expect(new URL(url).pathname.startsWith(`/${META_GRAPH_VERSION}/`)).toBe(true);
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

describe("Meta Graph version", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows the version string only in the shared constant", () => {
    const hits: { file: string; count: number }[] = [];
    for (const file of sourceFiles(adsRoot)) {
      const count = readFileSync(file, "utf8").match(versionLiteral)?.length ?? 0;
      if (count > 0) hits.push({ file, count });
    }
    expect(hits).toEqual([{ file: definitionFile, count: 1 }]);
    const source = readFileSync(definitionFile, "utf8");
    expect(source).toContain(`export const META_GRAPH_VERSION = "${META_GRAPH_VERSION}"`);
  });

  it("builds the OAuth dialog from the shared constant", () => {
    const previous = process.env.META_APP_ID;
    process.env.META_APP_ID = "app-id-not-a-token";
    try {
      const url = new URL(metaAuthorizeUrl("state-1"));
      expect(`${url.origin}${url.pathname}`).toBe(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
      expect(url.searchParams.get("client_id")).toBe("app-id-not-a-token");
      expect(metaAdPlatformConnector.authorizeUrl("state-1")).toBe(url.toString());
    } finally {
      if (previous === undefined) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = previous;
    }
  });

  it("reports the Graph version on ads-api and worker health", async () => {
    const config = oauthConfig();
    expect(config.meta.apiVersion).toBe(META_GRAPH_VERSION);
    expect(config.google).not.toHaveProperty("apiVersion");

    const worker = workerHealthBody({ dbOk: true, inngestStatus: "ok", functionIds: ["ads-sync"] });
    expect(worker.oauth.meta.apiVersion).toBe(META_GRAPH_VERSION);
    expect(worker.oauth.meta).not.toHaveProperty("appId");
    expect(JSON.stringify(worker)).not.toContain(TOKEN);

    const res = await app.request("/health");
    const body = (await res.json()) as { oauth: { meta: { apiVersion?: string; configured?: boolean } } };
    expect(body.oauth.meta.apiVersion).toBe(META_GRAPH_VERSION);
    expect(typeof body.oauth.meta.configured).toBe("boolean");
    expect(body.oauth.meta).not.toHaveProperty("appId");
  });

  it("pulls campaigns, ad sets, ads, and insights on the shared Graph version", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/campaigns")) {
        return jsonResponse({
          data: [{
            id: "120",
            name: "Search HVAC",
            status: "ACTIVE",
            effective_status: "ACTIVE",
            updated_time: "2026-07-01T00:00:00+0000",
            objective: "OUTCOME_LEADS",
          }],
        });
      }
      if (parsed.pathname.endsWith("/adsets")) {
        return jsonResponse({
          data: [{
            id: "220",
            name: "Ad set",
            status: "PAUSED",
            effective_status: "PAUSED",
            updated_time: "2026-07-02T00:00:00+0000",
            campaign_id: "120",
          }],
        });
      }
      if (parsed.pathname.endsWith("/ads")) {
        return jsonResponse({
          data: [{
            id: "320",
            name: "Ad",
            status: "ACTIVE",
            effective_status: "ACTIVE",
            updated_time: "2026-07-03T00:00:00+0000",
            adset_id: "220",
          }],
        });
      }
      if (parsed.pathname.endsWith("/insights")) {
        const preset = parsed.searchParams.get("date_preset");
        const level = parsed.searchParams.get("level");
        if (level === "campaign" && preset === "last_7d") {
          return jsonResponse({
            data: [{
              campaign_id: "120",
              spend: "10.00",
              impressions: "1000",
              clicks: "25",
              actions: [{ action_type: "lead", value: "2" }],
              date_start: "2026-06-24",
              date_stop: "2026-06-30",
            }],
          });
        }
        return jsonResponse({ data: [] });
      }
      throw new Error(`unexpected ${parsed.pathname}`);
    });

    const pulled = await metaAdPlatformConnector.pull({
      platform: "meta",
      externalId: "act_9",
      clientName: "Pilot",
      tokens: { accessToken: TOKEN, mock: false },
      allowLive: true,
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) usesGraphVersion(url);
    expect(calls.some((url) => url.includes("fields=id,name,status,effective_status,updated_time,objective"))).toBe(true);
    expect(calls.some((url) => url.includes("fields=id,name,status,effective_status,updated_time,campaign_id"))).toBe(true);
    expect(calls.some((url) => url.includes("fields=id,name,status,effective_status,updated_time,adset_id"))).toBe(true);
    expect(calls.some((url) => url.includes("fields=campaign_id,spend,impressions,clicks,actions"))).toBe(true);
    expect(pulled.mode).toBe("live");
    expect(pulled.entities.map((row) => ({ type: row.entityType, id: row.externalId, status: row.status }))).toEqual([
      { type: "campaign", id: "120", status: "active" },
      { type: "adset", id: "220", status: "paused" },
      { type: "ad", id: "320", status: "active" },
    ]);
    expect(pulled.metrics).toEqual([
      expect.objectContaining({
        entityExternalId: "120",
        entityType: "campaign",
        window: "7d",
        spendUsd: "10.00",
        impressions: 1000,
        clicks: 25,
        conversions: "2",
      }),
    ]);
  });

  it("re-checks campaign budget and ad set bid on the shared Graph version", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      const fields = new URL(String(url)).searchParams.get("fields");
      if (fields === "id,name,status,account_id,daily_budget") {
        return jsonResponse({ id: "238", name: "HVAC", status: "ACTIVE", daily_budget: "5000", account_id: "55" });
      }
      return jsonResponse({ id: "220", name: "Ad set", status: "ACTIVE", bid_amount: "250", account_id: "55" });
    });

    const campaign = await metaAdPlatformConnector.readLiveEntityState({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause"),
    });
    const adset = await metaAdPlatformConnector.readLiveEntityState({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("update_bid", {}, "adset", "220"),
    });

    expect(campaign).toMatchObject({ externalId: "238", status: "active", dailyBudget: 50 });
    expect(adset).toMatchObject({ externalId: "220", status: "active", bidAmount: 2.5 });
    expect(calls).toHaveLength(2);
    for (const url of calls) usesGraphVersion(url);
    expect(new URL(calls[0]).pathname).toBe(`/${META_GRAPH_VERSION}/238`);
    expect(new URL(calls[0]).searchParams.get("fields")).toBe("id,name,status,account_id,daily_budget");
    expect(new URL(calls[1]).pathname).toBe(`/${META_GRAPH_VERSION}/220`);
    expect(new URL(calls[1]).searchParams.get("fields")).toBe("id,name,status,account_id,bid_amount");
  });

  it("writes pause, budget, bid, create, and placement on the shared Graph version", async () => {
    const calls: { url: string; body: string; authorization: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), body: String(init.body ?? ""), authorization: headers.authorization ?? "" });
      const path = new URL(String(url)).pathname;
      if (new URL(String(url)).searchParams.get("fields") === "currency") {
        return jsonResponse({ currency: "USD", account_id: "55" });
      }
      if (path.endsWith("/adcreatives")) return jsonResponse({ id: "cr1" });
      if (path.endsWith("/ads")) return jsonResponse({ id: "ad1" });
      return jsonResponse({ success: true });
    });

    const tokens = { accessToken: TOKEN, mock: false };
    const live = {
      externalId: "238",
      entityType: "campaign",
      status: "active",
      dailyBudget: 50,
      bidAmount: 2,
      accountId: "55",
    };

    const paused = await metaAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("pause"),
      live,
      accountExternalId: "act_55",
    });
    const budget = await metaAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("update_budget", { amount: 40 }),
      live,
      accountExternalId: "act_55",
    });
    const bid = await metaAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("update_bid", { amount: 1.5 }),
      live,
      accountExternalId: "act_55",
    });
    const created = await metaAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation(
        "create_ad",
        {
          proposedName: "Variant",
          body: "Hello",
          headline: "Heat",
          pageId: "1001",
          link: "https://pilot.example/heat",
        },
        "adset",
        "221",
      ),
      live: { externalId: "221", entityType: "adset", status: "active", accountId: "55" },
      accountExternalId: "act_55",
    });
    const placement = await metaAdPlatformConnector.applyLive({
      tokens,
      mutation: mutation("exclude_placement", { placement: "audience_network" }, "adset", "220"),
      live,
      accountExternalId: "act_55",
    });

    expect(paused).toMatchObject({ status: "applied", writes: true });
    expect(budget).toMatchObject({ status: "applied", writes: true });
    expect(bid).toMatchObject({ status: "applied", writes: true });
    expect(created).toMatchObject({ status: "applied", writes: true, target: { externalId: "ad1" } });
    expect(placement).toMatchObject({ status: "applied", writes: true });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      `/${META_GRAPH_VERSION}/238`,
      `/${META_GRAPH_VERSION}/act_55`,
      `/${META_GRAPH_VERSION}/238`,
      `/${META_GRAPH_VERSION}/act_55`,
      `/${META_GRAPH_VERSION}/238`,
      `/${META_GRAPH_VERSION}/act_55/adcreatives`,
      `/${META_GRAPH_VERSION}/act_55/ads`,
      `/${META_GRAPH_VERSION}/220`,
    ]);
    expect(new URLSearchParams(calls[0].body).get("status")).toBe("PAUSED");
    expect(new URL(calls[1].url).searchParams.get("fields")).toBe("currency");
    expect(new URLSearchParams(calls[2].body).get("daily_budget")).toBe("4000");
    expect(new URLSearchParams(calls[4].body).get("bid_amount")).toBe("150");
    expect(new URLSearchParams(calls[7].body).get("targeting")).toBe(
      JSON.stringify({ publisher_platforms: ["facebook", "instagram"] }),
    );
    for (const call of calls) {
      expect(new URLSearchParams(call.body).get("access_token")).toBeNull();
      expect(call.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
    }
  });

  it("logs one warning per response that carries the version header", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let page = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(String(url)).not.toContain(TOKEN);
      expect(String(url)).not.toContain("access_token=");
      page += 1;
      const paging = page === 1
        ? { next: `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?after=2` }
        : undefined;
      return jsonResponse(
        { data: [{ id: `act_${page}`, name: `Acct ${page}`, currency: "USD" }], paging: paging ? { next: paging.next } : undefined },
        "access_token=sekret-header Bearer sekret-bearer",
      );
    });

    const accounts = await metaAdPlatformConnector.listAccessibleAccounts({ accessToken: TOKEN });
    expect(accounts.map((row) => row.externalId)).toEqual(["act_1", "act_2"]);
    expect(warn).toHaveBeenCalledTimes(2);
    for (const call of warn.mock.calls) {
      const message = String(call[0]);
      expect(message.startsWith("Meta Graph X-Ad-Api-Version-Warning:")).toBe(true);
      expect(message).toContain("[redacted]");
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain("sekret-header");
      expect(message).not.toContain("sekret-bearer");
      expect(message).not.toContain("graph.facebook.com");
    }
  });

  it("does not warn when the version header is absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => jsonResponse({ id: "238", name: "HVAC", status: "ACTIVE", daily_budget: "100" }));
    await metaAdPlatformConnector.readLiveEntityState({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause"),
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
