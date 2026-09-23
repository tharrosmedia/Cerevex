import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containsRawSecret } from "@tharros/ads-shared/crypto";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { adAccounts, adEntities, adMetrics } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

describe("ad account sync", () => {
  let ownerToken = "";
  let scopedToken = "";
  let accountId = "";
  let otherClientId = "";

  beforeAll(async () => {
    await ensureScopedUser();
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    scopedToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;

    const clientsRes = await app.request("/clients", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    const gotDuctlessId = clients.find((c) => c.name === "Got Ductless")?.id ?? "";
    otherClientId = clients.find((c) => c.name === "KC Prestige")?.id ?? "";

    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId: gotDuctlessId, platform: "google" }),
    });
    accountId = String(((await json(connect)).adAccount as { id: string }).id);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("pulls mock entities and metrics without calling Meta or Google", async () => {
    const result = await runAdAccountSync(accountId);
    expect(result.status).toBe("connected");
    expect(result.mode).toBe("mock");
    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.lastError).toBeNull();

    const account = await getDb().query.adAccounts.findFirst({
      where: eq(adAccounts.id, accountId),
    });
    expect(account?.connectionStatus).toBe("connected");
    expect(account?.lastSyncAt).toBeTruthy();
    expect(account?.lastError).toBeNull();

    const entities = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, accountId));
    const metrics = await getDb().select().from(adMetrics).where(eq(adMetrics.adAccountId, accountId));
    expect(entities.some((e) => e.entityType === "campaign")).toBe(true);
    expect(entities.some((e) => e.entityType === "keyword")).toBe(true);
    expect(metrics.some((m) => m.window === "7d")).toBe(true);
    expect(containsRawSecret(entities.map((e) => e.rawJson))).toBe(false);
  });

  it("enqueues sync over HTTP without blocking on a live network pull", async () => {
    const res = await app.request(`/ad-accounts/${accountId}/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = await json(res);
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(body.status).toBe("queued");
      expect(body.name).toBe("ads/account.sync");
      expect(JSON.stringify(body)).not.toContain("mock-access");
    }
  });

  it("rejects sync and account reads across tenants", async () => {
    const sync = await app.request(`/ad-accounts/${accountId}/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(sync.status).toBe(403);

    const connectOther = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId: otherClientId, platform: "meta" }),
    });
    const otherAccountId = String(((await json(connectOther)).adAccount as { id: string }).id);
    const leak = await app.request(`/ad-accounts/${otherAccountId}`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(leak.status).toBe(404);
  });
});
