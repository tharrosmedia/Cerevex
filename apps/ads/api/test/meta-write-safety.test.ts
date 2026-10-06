import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { isApplySafetyCapability } from "@cerevex/contracts";
import { defaultCapabilityFlags, resolveWorkspaceCapabilities } from "@tharros/ads-shared";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import {
  META_COULD_NOT_CONFIRM,
  META_CURRENCY_REASON,
  META_TARGET_ID_REASON,
  META_TARGET_NOT_IN_ACCOUNT,
  META_TWO_DECIMAL_CURRENCIES,
  applyBlockMessage,
  isMetaTwoDecimalCurrency,
} from "@tharros/ads-shared/apply-gate";
import { metaAdPlatformConnector } from "@tharros/ads-shared/connectors";
import { storeTokens } from "@tharros/ads-shared/credentials";
import { applyViaConnector, executeMutation } from "@tharros/ads-shared/mutate";
import { META_GRAPH_VERSION } from "@tharros/ads-shared";
import {
  adAccounts,
  applyJobs,
  auditLog,
  memberships,
  recommendations,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const TOKEN = "m4-live-token-not-for-logs";
const ZERO_DECIMAL = ["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"];

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

function live(accountId = "55", extra: Record<string, unknown> = {}) {
  return {
    externalId: "238",
    entityType: "campaign",
    status: "active",
    dailyBudget: 50,
    bidAmount: 2,
    accountId,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const createPayload = {
  proposedName: "Variant",
  body: "Hello",
  pageId: "1001",
  link: "https://pilot.example/offer",
};

describe("Meta write safety fixtures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the 2-decimal currencies and refuses the zero-decimal ones", () => {
    expect(META_TWO_DECIMAL_CURRENCIES).toEqual([
      "AED", "ARS", "AUD", "BDT", "BGN", "BHD", "BOB", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "DZD",
      "EGP", "EUR", "FBZ", "GBP", "GTQ", "HKD", "HNL", "HRK", "ILS", "INR", "JOD", "KES", "LTL", "LVL",
      "MOP", "MXN", "MYR", "NGN", "NIO", "NOK", "NZD", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RSD",
      "RUB", "SAR", "SEK", "SGD", "SKK", "THB", "TRY", "UAH", "USD", "UYU", "VEF", "VES", "ZAR",
    ]);
    for (const code of META_TWO_DECIMAL_CURRENCIES) expect(isMetaTwoDecimalCurrency(code)).toBe(true);
    expect(isMetaTwoDecimalCurrency("usd")).toBe(true);
    for (const code of ZERO_DECIMAL) expect(isMetaTwoDecimalCurrency(code)).toBe(false);
    expect(isMetaTwoDecimalCurrency("XXX")).toBe(false);
    expect(isMetaTwoDecimalCurrency("")).toBe(false);
    expect(isApplySafetyCapability("apply.meta")).toBe(true);
    expect(defaultCapabilityFlags()["apply.meta"]).toBe("hidden");
  });

  it.each([
    ["placement", mutation("exclude_placement", {}, "adset", "220"), "Missing placement. Nothing was written."],
    ["page id", mutation("create_ad", { ...createPayload, pageId: "  " }, "adset", "221"), "Missing page id. Nothing was written."],
    ["link", mutation("create_ad", { proposedName: "Variant", body: "Hello", pageId: "1001" }, "adset", "221"), "Missing link. Nothing was written."],
    ["name", mutation("create_ad", { body: "Hello", pageId: "1001", link: "https://pilot.example/offer" }, "adset", "221"), "Missing name. Nothing was written."],
    ["message", mutation("create_ad", { proposedName: "Variant", pageId: "1001", link: "https://pilot.example/offer" }, "adset", "221"), "Missing message. Nothing was written."],
  ] as const)("missing %s fails and writes nothing", async (_field, change, reason) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await metaAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: change,
      live: live(),
      accountExternalId: "act_55",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.writes).toBe(false);
    expect(outcome.reason).toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a target id that is not digits only", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const externalId of ["adset-1", "act_55", "12a", "238 "]) {
      const outcome = await applyViaConnector({
        platform: "meta",
        tokens: { accessToken: TOKEN, mock: false },
        mutation: mutation("pause", {}, "campaign", externalId),
        accountExternalId: "act_55",
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.writes).toBe(false);
      expect(outcome.reason).toBe(META_TARGET_ID_REASON);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a target whose account_id is a different ad account", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET" });
      return jsonResponse({ id: "238", status: "ACTIVE", account_id: "999" });
    });
    const outcome = await applyViaConnector({
      platform: "meta",
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause"),
      accountExternalId: "act_55",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.writes).toBe(false);
    expect(outcome.reason).toContain(META_TARGET_NOT_IN_ACCOUNT);
    expect(outcome.reason).toContain("Nothing was written.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("fail-closes pause, budget, and bid when the live re-check fails", async () => {
    for (const action of ["pause", "update_budget", "update_bid"] as const) {
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? "GET"} ${url}`);
        return new Response("down", { status: 500 });
      });
      const outcome = await applyViaConnector({
        platform: "meta",
        tokens: { accessToken: TOKEN, mock: false },
        mutation: mutation(action, action === "pause" ? {} : { amount: 10 }, action === "pause" ? "campaign" : "adset", "220"),
        accountExternalId: "act_55",
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.writes).toBe(false);
      expect(outcome.reason).toBe(META_COULD_NOT_CONFIRM);
      expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
      vi.unstubAllGlobals();
    }
  });

  it("reads an ad set budget before a change and refuses a non-2-decimal currency", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: String(init.body ?? "") });
      const fields = new URL(String(url)).searchParams.get("fields");
      if (fields === "currency") return jsonResponse({ currency: "JPY", account_id: "55" });
      return jsonResponse({ id: "220", status: "ACTIVE", account_id: "55", daily_budget: "5000" });
    });
    const outcome = await applyViaConnector({
      platform: "meta",
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("update_budget", { amount: 40 }, "adset", "220"),
      accountExternalId: "act_55",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.writes).toBe(false);
    expect(outcome.reason).toBe(META_CURRENCY_REASON);
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe("id,name,status,account_id,daily_budget");
    expect(new URL(calls[0].url).pathname).toBe(`/${META_GRAPH_VERSION}/220`);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("writes a budget only after a 2-decimal currency read", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: String(init.body ?? "") });
      if (new URL(String(url)).searchParams.get("fields") === "currency") {
        return jsonResponse({ currency: "USD", account_id: "55" });
      }
      return jsonResponse({ success: true });
    });
    const outcome = await metaAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("update_budget", { amount: 40 }, "adset", "220"),
      live: live("55", { externalId: "220", entityType: "adset", dailyBudget: 50 }),
      accountExternalId: "act_55",
    });
    expect(outcome).toMatchObject({ status: "applied", writes: true });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(new URLSearchParams(calls[1].body).get("daily_budget")).toBe("4000");
    expect(calls[1].body).not.toContain(TOKEN);
  });
});

describe("apply.meta approve and owner toggle", () => {
  let ownerToken = "";
  let ownerId = "";
  let clientId = "";
  let workspaceId = "";
  let kill: boolean | undefined;
  let settingsSnapshot: unknown;

  beforeAll(async () => {
    await ensureScopedUser();
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    ownerToken = owner.token;
    const me = await json(await app.request("/auth/me", { headers: { authorization: `Bearer ${ownerToken}` } }));
    ownerId = String((me.user as { id: string }).id);
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${ownerToken}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string; workspaceId: string }[];
    const got = clients.find((row) => row.name === "Got Ductless");
    if (!got) throw new Error("Seed client missing");
    clientId = got.id;
    workspaceId = got.workspaceId;
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    kill = workspace?.applyKillSwitch;
    settingsSnapshot = workspace?.settingsJson;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await getDb()
      .update(workspaces)
      .set({
        applyKillSwitch: kill ?? true,
        ...(settingsSnapshot !== undefined ? { settingsJson: settingsSnapshot } : {}),
      })
      .where(eq(workspaces.id, workspaceId));
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setFlag(state: "hidden" | "recommend_only" | "on", token = ownerToken) {
    return app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "apply.meta": state }, workspaceId }),
    });
  }

  async function seedLiveAccount() {
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "meta",
        externalId: `act_880${Date.now().toString().slice(-6)}`,
        displayName: "M4 write safety",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "meta",
      label: "live",
      tokens: { accessToken: TOKEN, mock: false },
    });
    const [rec] = await getDb()
      .insert(recommendations)
      .values({
        workspaceId,
        clientId,
        adAccountId: account.id,
        type: "pause_waste",
        title: "Pause stays unsent",
        rationale: "apply.meta is not on.",
        risk: "low",
        evidenceJson: { writes: false },
        proposedMutationsJson: [
          {
            platform: "meta",
            action: "pause",
            target: { entityType: "campaign", externalId: "88001", name: "Kept" },
            payload: {},
          },
        ],
        status: "proposed",
        schemaVersion: "1",
      })
      .returning();
    return { account, rec };
  }

  it("lets only the owner turn apply.meta on, and audits enable and disable", async () => {
    const email = "operator.m4@tharrosmedia.com";
    const passwordHash = await hash("operator-m4-local", 10);
    const existing = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ??
      (await getDb().insert(users).values({ email, name: "M4 operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await getDb().update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await getDb()
      .insert(memberships)
      .values({ userId: operator.id, workspaceId, role: "operator" })
      .onConflictDoNothing();
    const operatorToken = (await login(email, "operator-m4-local")).token;

    const operatorOn = await setFlag("on", operatorToken);
    expect(operatorOn.status).toBe(403);
    const stillHidden = resolveWorkspaceCapabilities(
      (await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.settingsJson,
    );
    expect(stillHidden["apply.meta"]).toBe("hidden");

    const ownerOn = await setFlag("on");
    expect(ownerOn.status).toBe(200);
    const enabled = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, workspaceId))).filter(
      (row) => row.action === "apply.meta_enabled",
    );
    expect(enabled.some((row) => row.actorId === ownerId)).toBe(true);
    expect(JSON.stringify(enabled)).not.toContain(TOKEN);

    const ownerOff = await setFlag("hidden");
    expect(ownerOff.status).toBe(200);
    const disabled = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, workspaceId))).filter(
      (row) => row.action === "apply.meta_disabled",
    );
    expect(disabled.some((row) => row.actorId === ownerId)).toBe(true);
  });

  it("records Approve and writes nothing when apply.meta is hidden or recommend-only", async () => {
    await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const state of ["hidden", "recommend_only"] as const) {
      if (state === "recommend_only") expect((await setFlag(state)).status).toBe(200);
      const { account, rec } = await seedLiveAccount();
      try {
        const res = await app.request(`/recommendations/${rec.id}/decide`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        });
        expect(res.status).toBe(200);
        const body = await json(res);
        expect(body.writes).toBe(false);
        expect(body.applied).toBe(false);
        expect(body.applyJob).toBeNull();
        expect(body.reason).toBe(state === "hidden" ? "apply_meta_hidden" : "apply_meta_recommend_only");
        expect(body.note).toBe(
          applyBlockMessage(state === "hidden" ? "apply_meta_hidden" : "apply_meta_recommend_only"),
        );
        expect((body.recommendation as { status: string }).status).toBe("authorized");
        const authorizationId = (body.authorization as { id: string }).id;
        const jobs = await getDb().select().from(applyJobs).where(eq(applyJobs.authorizationId, authorizationId));
        expect(jobs).toHaveLength(0);
        const direct = await executeMutation({
          adAccountId: account.id,
          platform: "meta",
          accountExternalId: account.externalId,
          mutation: mutation("pause", {}, "campaign", "88001"),
          capabilities:
            state === "hidden"
              ? defaultCapabilityFlags()
              : { ...defaultCapabilityFlags(), "apply.meta": "recommend_only" },
        });
        expect(direct.writes).toBe(false);
        expect(direct.reason).toBe(applyBlockMessage(state === "hidden" ? "apply_meta_hidden" : "apply_meta_recommend_only"));
      } finally {
        await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still writes nothing when the kill switch is on, even if apply.meta is on", async () => {
    expect((await setFlag("on")).status).toBe(200);
    await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
    const { account, rec } = await seedLiveAccount();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await app.request(`/recommendations/${rec.id}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(res.status).toBe(409);
      const body = await json(res);
      expect(String(body.error)).toMatch(/paused/i);
      const stored = await getDb().query.recommendations.findFirst({ where: eq(recommendations.id, rec.id) });
      expect(stored?.status).toBe("proposed");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });
});
