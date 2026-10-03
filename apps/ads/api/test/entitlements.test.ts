import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE,
  SCHOLARSHIP_LOCATION_MESSAGE,
  adAccountLimitMessage,
  decideAdAccountActivation,
  decideLocationActivation,
  scholarshipDowngradeAdAccountMessage,
} from "@cerevex/contracts";
import { getAdPlatformConnector } from "@tharros/ads-shared/connectors";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { setClientPlan } from "@tharros/ads-shared/entitlements";
import { adAccounts, clients, locations, workspaces } from "@tharros/ads-shared/schema";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { createPendingConnection } from "../src/pending-connect";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

function databaseMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error) return error.cause.message;
  return error instanceof Error ? error.message : String(error);
}

const PAID_NAME = "Entitlement Paid";
const SCHOLARSHIP_NAME = "Entitlement Scholarship";
const DOWNGRADE_ADS_NAME = "Entitlement Downgrade Ads";
const DOWNGRADE_OK_NAME = "Entitlement Downgrade Ok";
const SYNC_NAME = "Entitlement Sync Guard";
const FIXTURE_NAMES = [PAID_NAME, SCHOLARSHIP_NAME, DOWNGRADE_ADS_NAME, DOWNGRADE_OK_NAME, SYNC_NAME];

describe("plan rules", () => {
  it("lets a paid tenant add locations and ad accounts with no limit", () => {
    expect(
      decideLocationActivation({
        plan: "paid",
        storeId: "store-b",
        activeStoreIds: ["store-a"],
      }).allowed,
    ).toBe(true);
    expect(
      decideAdAccountActivation({
        plan: "paid",
        platform: "meta",
        activeExternalIds: ["act-1"],
        externalId: "act-2",
      }).allowed,
    ).toBe(true);
  });

  it("blocks a second scholarship location and ignores inactive ids the caller left out", () => {
    const blocked = decideLocationActivation({
      plan: "scholarship",
      storeId: "store-b",
      activeStoreIds: ["store-a"],
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.message).toBe(SCHOLARSHIP_LOCATION_MESSAGE);

    expect(
      decideLocationActivation({
        plan: "scholarship",
        storeId: "store-b",
        activeStoreIds: [],
      }).allowed,
    ).toBe(true);
  });

  it("allows a location swap and one ad account on each platform, including a platform added later", () => {
    expect(
      decideLocationActivation({
        plan: "scholarship",
        storeId: "store-b",
        activeStoreIds: ["store-a"],
        replacingStoreId: "store-a",
      }).allowed,
    ).toBe(true);

    const secondMeta = decideAdAccountActivation({
      plan: "scholarship",
      platform: "meta",
      activeExternalIds: ["act-1"],
      externalId: "act-2",
    });
    expect(secondMeta.allowed).toBe(false);
    if (!secondMeta.allowed) expect(secondMeta.message).toBe(adAccountLimitMessage("meta"));

    expect(
      decideAdAccountActivation({
        plan: "scholarship",
        platform: "google",
        activeExternalIds: [],
        externalId: "customers/1",
      }).allowed,
    ).toBe(true);

    const secondOther = decideAdAccountActivation({
      plan: "scholarship",
      platform: "tiktok",
      activeExternalIds: ["tt-1"],
      externalId: "tt-2",
    });
    expect(secondOther.allowed).toBe(false);
    if (!secondOther.allowed) expect(secondOther.message).toContain("tiktok");

    expect(
      decideAdAccountActivation({
        plan: "scholarship",
        platform: "meta",
        activeExternalIds: ["pending"],
        externalId: "act-1",
        replacingExternalId: "pending",
      }).allowed,
    ).toBe(true);
  });
});

describe("plan and location entitlements", () => {
  let ownerToken = "";
  let ownerUserId = "";
  let workspaceId = "";
  let paidId = "";
  let scholarshipId = "";

  const owner = () => ({ authorization: `Bearer ${ownerToken}`, "content-type": "application/json" });

  async function activate(clientId: string, storeId: string) {
    return app.request(`/clients/${clientId}/locations`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ storeId }),
    });
  }

  async function deactivate(clientId: string, storeId: string) {
    return app.request(`/clients/${clientId}/locations/deactivate`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ storeId }),
    });
  }

  async function connectAccounts(clientId: string, platform: "meta" | "google", externalIds: string[]) {
    const pendingId = await createPendingConnection({
      workspaceId,
      clientId,
      platform,
      userId: ownerUserId,
      tokens: { accessToken: "entitlement-test-token", mock: true },
      accounts: externalIds.map((externalId) => ({ externalId, name: externalId })),
    });
    return app.request(`/oauth/pending/${pendingId}/select`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ externalIds }),
    });
  }

  beforeAll(async () => {
    const { workspace } = await ensureScopedUser();
    workspaceId = workspace.id;
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    const me = await json(await app.request("/auth/me", { headers: owner() }));
    ownerUserId = String((me.user as { id: string }).id);

    const db = getDb();
    await db.delete(clients).where(inArray(clients.name, FIXTURE_NAMES));
    const [paid] = await db
      .insert(clients)
      .values({ workspaceId, name: PAID_NAME, status: "active", plan: "paid" })
      .returning();
    const [scholarship] = await db
      .insert(clients)
      .values({ workspaceId, name: SCHOLARSHIP_NAME, status: "active", plan: "scholarship" })
      .returning();
    paidId = paid.id;
    scholarshipId = scholarship.id;
  });

  afterAll(async () => {
    await getDb().delete(clients).where(inArray(clients.name, FIXTURE_NAMES));
    await closeDb();
  });

  it("keeps the kill switch on and leaves internal clients uncapped", async () => {
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    expect(workspace?.applyKillSwitch).toBe(true);
    const pilots = await getDb()
      .select({ plan: clients.plan })
      .from(clients)
      .where(inArray(clients.name, ["Got Ductless", "KC Prestige", "Elmar HVAC"]));
    expect(pilots.every((row) => row.plan === "paid")).toBe(true);
  });

  it("lets a paid tenant activate more than one location and more than one ad account", async () => {
    const first = await activate(paidId, "paid-store-a");
    const second = await activate(paidId, "paid-store-b");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const connected = await connectAccounts(paidId, "meta", ["act_paid_1", "act_paid_2"]);
    expect(connected.status).toBe(200);
    expect((await json(connected)).connected).toBe(2);

    const view = await json(await app.request(`/clients/${paidId}/entitlements`, { headers: owner() }));
    const entitlements = view.entitlements as {
      plan: string;
      locations: { limit: number | null; activeCount: number };
      adAccounts: { limitPerPlatform: number | null; activeByPlatform: Record<string, number> };
      monthly: { creativeVariations: { limit: number | null; used: number | null }; seoJobs: { limit: number | null } };
    };
    expect(entitlements.plan).toBe("paid");
    expect(entitlements.locations).toEqual({ limit: null, activeCount: 2 });
    expect(entitlements.adAccounts.limitPerPlatform).toBeNull();
    expect(entitlements.adAccounts.activeByPlatform.meta).toBe(2);
    expect(entitlements.monthly.creativeVariations.limit).toBeNull();
    expect(entitlements.monthly.creativeVariations.used).toBeNull();
    expect(entitlements.monthly.seoJobs.limit).toBeNull();
  });

  it("blocks a second active scholarship location with a plain message", async () => {
    expect((await activate(scholarshipId, "scholar-store-a")).status).toBe(200);
    const blocked = await activate(scholarshipId, "scholar-store-b");
    expect(blocked.status).toBe(409);
    const body = await json(blocked);
    expect(body.error).toBe(SCHOLARSHIP_LOCATION_MESSAGE);
    expect(String(body.error)).not.toMatch(/tenant|entitlement|store_id|\bcap\b/i);

    const rows = await getDb().select().from(locations).where(eq(locations.clientId, scholarshipId));
    expect(rows.filter((row) => row.status === "active").map((row) => row.storeId)).toEqual(["scholar-store-a"]);
  });

  it("lets a scholarship tenant swap locations, and inactive locations do not count", async () => {
    expect((await deactivate(scholarshipId, "scholar-store-a")).status).toBe(200);
    const swapped = await activate(scholarshipId, "scholar-store-b");
    expect(swapped.status).toBe(200);

    const stillBlocked = await activate(scholarshipId, "scholar-store-c");
    expect(stillBlocked.status).toBe(409);

    const rows = await getDb().select().from(locations).where(eq(locations.clientId, scholarshipId));
    const byStore = Object.fromEntries(rows.map((row) => [row.storeId, row.status]));
    expect(byStore["scholar-store-a"]).toBe("inactive");
    expect(byStore["scholar-store-b"]).toBe("active");
    expect(byStore["scholar-store-c"]).toBeUndefined();

    const view = await json(await app.request(`/clients/${scholarshipId}/entitlements`, { headers: owner() }));
    const entitlements = view.entitlements as {
      locations: { limit: number; activeCount: number };
      monthly: {
        creativeVariations: { limit: number; used: number | null; excludedOutcomes: string[]; reset: string };
        seoJobs: { limit: number; used: number | null };
      };
    };
    expect(entitlements.locations).toEqual({ limit: 1, activeCount: 1 });
    expect(entitlements.monthly.creativeVariations.limit).toBe(20);
    expect(entitlements.monthly.creativeVariations.used).toBeNull();
    expect(entitlements.monthly.creativeVariations.excludedOutcomes).toEqual(["rejected", "duplicate", "merged"]);
    expect(entitlements.monthly.creativeVariations.reset).toBe("month_start_et");
    expect(entitlements.monthly.seoJobs).toMatchObject({ limit: 10, used: null });
  });

  it("blocks a second ad account on the same platform and allows one on another", async () => {
    const both = await connectAccounts(scholarshipId, "meta", ["act_scholar_1", "act_scholar_2"]);
    expect(both.status).toBe(409);
    expect((await json(both)).error).toBe(adAccountLimitMessage("meta"));
    const none = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, scholarshipId));
    expect(none.filter((row) => row.platform === "meta")).toHaveLength(0);

    expect((await connectAccounts(scholarshipId, "meta", ["act_scholar_1"])).status).toBe(200);
    const google = await connectAccounts(scholarshipId, "google", ["customers/scholar-1"]);
    expect(google.status).toBe(200);

    const secondMeta = await connectAccounts(scholarshipId, "meta", ["act_scholar_2"]);
    expect(secondMeta.status).toBe(409);
    expect((await json(secondMeta)).error).toBe(adAccountLimitMessage("meta"));

    const metaRows = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, scholarshipId));
    expect(metaRows.map((row) => row.externalId).sort()).toEqual(["act_scholar_1", "customers/scholar-1"]);
  });

  it("lets a scholarship tenant swap ad accounts", async () => {
    const current = await getDb().query.adAccounts.findFirst({
      where: eq(adAccounts.externalId, "act_scholar_1"),
    });
    expect(current?.id).toBeTruthy();
    const disconnected = await app.request(`/ad-accounts/${current!.id}/disconnect`, {
      method: "POST",
      headers: owner(),
    });
    expect(disconnected.status).toBe(200);

    const swapped = await connectAccounts(scholarshipId, "meta", ["act_scholar_2"]);
    expect(swapped.status).toBe(200);

    const rows = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, scholarshipId));
    const meta = Object.fromEntries(
      rows.filter((row) => row.platform === "meta").map((row) => [row.externalId, row.connectionStatus]),
    );
    expect(meta.act_scholar_1).toBe("disconnected");
    expect(meta.act_scholar_2).toBe("connected");
    expect(rows.find((row) => row.externalId === "customers/scholar-1")?.connectionStatus).toBe("connected");
  });

  it("redirects a one-account OAuth connect when the Scholarship slot is taken", async () => {
    const connector = getAdPlatformConnector("meta");
    const exchange = vi.spyOn(connector, "exchangeCode").mockResolvedValue({
      tokens: { accessToken: "plan-limit-test", mock: true },
      externalId: "act_oauth_blocked",
    });
    const list = vi.spyOn(connector, "listAccessibleAccounts").mockResolvedValue([
      { externalId: "act_oauth_blocked", name: "Blocked Meta" },
    ]);
    try {
      const { signOAuthState } = await import("../src/oauth-state");
      const state = await signOAuthState({
        userId: ownerUserId,
        clientId: scholarshipId,
        platform: "meta",
      });
      const callback = await app.request(
        `/oauth/meta/callback?code=plan-limit-test&state=${encodeURIComponent(state)}`,
      );
      expect(callback.status).toBe(302);
      const url = new URL(callback.headers.get("location") ?? "", "http://127.0.0.1");
      expect(url.searchParams.get("oauth_error")).toBe("plan_limit");
      expect(url.searchParams.get("connect_error")).toBe(adAccountLimitMessage("meta"));
      const rows = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, scholarshipId));
      expect(rows.some((row) => row.externalId === "act_oauth_blocked")).toBe(false);
      expect(rows.filter((row) => row.platform === "meta" && row.connectionStatus !== "disconnected")).toHaveLength(1);
    } finally {
      exchange.mockRestore();
      list.mockRestore();
    }
  });

  it("treats a site link as a location and allows swapping that site", async () => {
    expect((await deactivate(scholarshipId, "scholar-store-b")).status).toBe(200);
    const link = async (siteId: string) =>
      app.request(`/clients/${scholarshipId}/site`, {
        method: "POST",
        headers: owner(),
        body: JSON.stringify({ siteId }),
      });
    expect((await link("scholar-site-a")).status).toBe(200);
    const swapped = await link("scholar-site-b");
    expect(swapped.status).toBe(200);
    expect((await json(swapped)).client).toMatchObject({ siteId: "scholar-site-b", plan: "scholarship" });

    const rows = await getDb().select().from(locations).where(eq(locations.clientId, scholarshipId));
    const byStore = Object.fromEntries(rows.map((row) => [row.storeId, row.status]));
    expect(byStore["scholar-site-a"]).toBe("inactive");
    expect(byStore["scholar-site-b"]).toBe("active");

    const extra = await activate(scholarshipId, "scholar-store-c");
    expect(extra.status).toBe(409);
    expect((await json(extra)).error).toBe(SCHOLARSHIP_LOCATION_MESSAGE);
  });

  it("refuses a raw insert that would pass the Scholarship limits", async () => {
    const db = getDb();
    await expect(
      db.insert(locations).values({
        workspaceId,
        clientId: scholarshipId,
        storeId: "scholar-raw-extra",
        status: "active",
      }),
    ).rejects.toSatisfy((error: unknown) => /Scholarship includes 1 location/.test(databaseMessage(error)));

    await expect(
      db.insert(adAccounts).values({
        workspaceId,
        clientId: scholarshipId,
        platform: "meta",
        externalId: "act_raw_blocked",
        connectionStatus: "connected",
        scopesJson: [],
      }),
    ).rejects.toSatisfy((error: unknown) => /1 Meta ad account/.test(databaseMessage(error)));

    const paidInsert = await db
      .insert(locations)
      .values({
        workspaceId,
        clientId: paidId,
        storeId: "paid-store-raw",
        status: "active",
      })
      .returning();
    expect(paidInsert).toHaveLength(1);

    const scholarRows = await db.select().from(locations).where(eq(locations.clientId, scholarshipId));
    expect(scholarRows.some((row) => row.storeId === "scholar-raw-extra")).toBe(false);
    const meta = await db.select().from(adAccounts).where(eq(adAccounts.clientId, scholarshipId));
    expect(meta.filter((row) => row.platform === "meta" && row.connectionStatus !== "disconnected")).toHaveLength(1);
  });

  it("keeps the linked site when a different location is turned off", async () => {
    expect((await deactivate(scholarshipId, "scholar-store-a")).status).toBe(200);
    const client = await getDb().query.clients.findFirst({ where: eq(clients.id, scholarshipId) });
    expect(client?.siteId).toBe("scholar-site-b");
  });

  it("clears the linked site in the same change that turns that location off", async () => {
    expect((await deactivate(scholarshipId, "scholar-site-b")).status).toBe(200);
    const client = await getDb().query.clients.findFirst({ where: eq(clients.id, scholarshipId) });
    expect(client?.siteId).toBeNull();
    const rows = await getDb().select().from(locations).where(eq(locations.clientId, scholarshipId));
    expect(rows.find((row) => row.storeId === "scholar-site-b")?.status).toBe("inactive");
  });

  it("refuses a move to Scholarship while the account is over the limits and turns nothing off", async () => {
    await expect(setClientPlan(paidId, "scholarship")).rejects.toThrow(SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE);
    const paid = await getDb().query.clients.findFirst({ where: eq(clients.id, paidId) });
    expect(paid?.plan).toBe("paid");
    const paidLocations = await getDb().select().from(locations).where(eq(locations.clientId, paidId));
    expect(paidLocations.filter((row) => row.status === "active").length).toBeGreaterThan(1);

    await expect(
      getDb().update(clients).set({ plan: "scholarship" }).where(eq(clients.id, paidId)),
    ).rejects.toSatisfy((error: unknown) => /more than one location turned on/.test(databaseMessage(error)));
    const stillPaid = await getDb().query.clients.findFirst({ where: eq(clients.id, paidId) });
    expect(stillPaid?.plan).toBe("paid");

    const db = getDb();
    const [adsClient] = await db
      .insert(clients)
      .values({ workspaceId, name: DOWNGRADE_ADS_NAME, status: "active", plan: "paid" })
      .returning();
    expect((await activate(adsClient.id, "downgrade-ads-store")).status).toBe(200);
    expect((await connectAccounts(adsClient.id, "meta", ["act_down_1", "act_down_2"])).status).toBe(200);
    await expect(setClientPlan(adsClient.id, "scholarship")).rejects.toThrow(
      scholarshipDowngradeAdAccountMessage("meta"),
    );
    const adsAfter = await db.query.clients.findFirst({ where: eq(clients.id, adsClient.id) });
    expect(adsAfter?.plan).toBe("paid");
    const adsAccounts = await db.select().from(adAccounts).where(eq(adAccounts.clientId, adsClient.id));
    expect(adsAccounts.filter((row) => row.connectionStatus !== "disconnected")).toHaveLength(2);

    const [okClient] = await db
      .insert(clients)
      .values({ workspaceId, name: DOWNGRADE_OK_NAME, status: "active", plan: "paid" })
      .returning();
    expect((await activate(okClient.id, "downgrade-ok-store")).status).toBe(200);
    expect((await connectAccounts(okClient.id, "meta", ["act_ok_1"])).status).toBe(200);
    const moved = await setClientPlan(okClient.id, "scholarship");
    expect(moved.plan).toBe("scholarship");
    const okLocations = await db.select().from(locations).where(eq(locations.clientId, okClient.id));
    expect(okLocations.find((row) => row.storeId === "downgrade-ok-store")?.status).toBe("active");
    const restored = await setClientPlan(okClient.id, "paid");
    expect(restored.plan).toBe("paid");
  });
});

describe("disconnected ad account sync", () => {
  let ownerToken = "";
  let ownerUserId = "";
  let workspaceId = "";
  let clientId = "";

  const owner = () => ({ authorization: `Bearer ${ownerToken}`, "content-type": "application/json" });

  async function connectOne(platform: "meta" | "google", externalId: string) {
    const pendingId = await createPendingConnection({
      workspaceId,
      clientId,
      platform,
      userId: ownerUserId,
      tokens: { accessToken: "entitlement-sync-token", mock: true },
      accounts: [{ externalId, name: externalId }],
    });
    const response = await app.request(`/oauth/pending/${pendingId}/select`, {
      method: "POST",
      headers: owner(),
      body: JSON.stringify({ externalIds: [externalId] }),
    });
    expect(response.status).toBe(200);
  }

  beforeAll(async () => {
    const { workspace } = await ensureScopedUser();
    workspaceId = workspace.id;
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    const me = await json(await app.request("/auth/me", { headers: owner() }));
    ownerUserId = String((me.user as { id: string }).id);
    await getDb().delete(clients).where(eq(clients.name, SYNC_NAME));
    const [row] = await getDb()
      .insert(clients)
      .values({ workspaceId, name: SYNC_NAME, status: "active", plan: "scholarship" })
      .returning();
    clientId = row.id;
  });

  afterAll(async () => {
    await getDb().delete(clients).where(eq(clients.name, SYNC_NAME));
    await closeDb();
  });

  it("leaves a disconnected account disconnected when it is synced after another account is connected", async () => {
    await connectOne("meta", "act_sync_a");
    const accountA = await getDb().query.adAccounts.findFirst({
      where: eq(adAccounts.externalId, "act_sync_a"),
    });
    expect(accountA?.id).toBeTruthy();

    const disconnected = await app.request(`/ad-accounts/${accountA!.id}/disconnect`, {
      method: "POST",
      headers: owner(),
    });
    expect(disconnected.status).toBe(200);

    await connectOne("meta", "act_sync_b");

    const synced = await runAdAccountSync(accountA!.id);
    expect(synced.status).toBe("skipped");
    expect(synced.entityCount).toBe(0);

    const rows = await getDb().select().from(adAccounts).where(eq(adAccounts.clientId, clientId));
    const meta = rows.filter((row) => row.platform === "meta");
    expect(meta.find((row) => row.externalId === "act_sync_a")?.connectionStatus).toBe("disconnected");
    expect(meta.filter((row) => row.connectionStatus !== "disconnected")).toEqual([
      expect.objectContaining({ externalId: "act_sync_b" }),
    ]);

    const refused = await app.request(`/ad-accounts/${accountA!.id}/sync`, {
      method: "POST",
      headers: owner(),
    });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toBe("That ad account is disconnected. Connect it again before syncing.");
    const afterRefusal = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, accountA!.id) });
    expect(afterRefusal?.connectionStatus).toBe("disconnected");
  });
});
