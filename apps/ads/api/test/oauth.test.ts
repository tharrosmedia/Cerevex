import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containsRawSecret, loadEnv } from "@tharros/ads-shared";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { decryptSecret } from "@tharros/ads-shared/crypto";
import { oauthCredentials } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

describe("OAuth token handling", () => {
  let ownerToken = "";
  let scopedToken = "";
  let gotDuctlessId = "";
  let otherClientId = "";
  let mockAccountId = "";

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
    gotDuctlessId = clients.find((c) => c.name === "Got Ductless")?.id ?? "";
    otherClientId = clients.find((c) => c.name === "KC Prestige")?.id ?? "";

    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId: gotDuctlessId, platform: "meta" }),
    });
    expect(connect.status).toBe(200);
    const body = await json(connect);
    mockAccountId = String((body.adAccount as { id: string }).id);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("never returns raw tokens or encrypted payloads to the web client", async () => {
    const detail = await app.request(`/clients/${gotDuctlessId}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const text = await detail.text();
    expect(detail.status).toBe(200);
    expect(text).not.toContain("mock-access-not-a-real-token");
    expect(text).not.toContain("mock-refresh");
    expect(text).not.toMatch(/encryptedPayload|encrypted_payload|accessToken|refreshToken/);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(containsRawSecret(parsed)).toBe(false);

    const account = await app.request(`/ad-accounts/${mockAccountId}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const accountText = await account.text();
    expect(accountText).not.toContain("mock-access-not-a-real-token");
    expect(containsRawSecret(JSON.parse(accountText))).toBe(false);
  });

  it("stores tokens encrypted at rest", async () => {
    const row = await getDb().query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.adAccountId, mockAccountId),
    });
    expect(row?.encryptedPayload).toBeTruthy();
    expect(row?.encryptedPayload).not.toContain("mock-access-not-a-real-token");
    const decrypted = decryptSecret(row!.encryptedPayload!);
    expect(decrypted).toContain("mock-access-not-a-real-token");
    expect(JSON.parse(decrypted).mock).toBe(true);
  });

  it("does not let a scoped user read another client's ad accounts", async () => {
    const leak = await app.request(`/clients/${otherClientId}/ad-accounts`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(leak.status).toBe(404);

    const allowed = await app.request(`/clients/${gotDuctlessId}/ad-accounts`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(allowed.status).toBe(200);
    const body = await json(allowed);
    expect(JSON.stringify(body)).not.toContain("mock-access-not-a-real-token");
  });

  it("blocks client_readonly from connecting", async () => {
    const res = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId: gotDuctlessId, platform: "google" }),
    });
    expect(res.status).toBe(403);
  });
});
