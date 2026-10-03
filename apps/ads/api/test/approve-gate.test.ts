import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

describe("M5 Adam-only Approve + freeze", () => {
  let ownerToken = "";
  let operatorToken = "";
  let clientId = "";
  let accountId = "";
  let recommendationId = "";

  beforeAll(async () => {
    await ensureScopedUser();
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;

    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.name, "Tharros Media"),
    });
    if (!workspace) throw new Error("workspace missing");
    const email = "operator@tharrosmedia.com";
    const passwordHash = await hash("operator-local-only", 10);
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const user =
      existing ??
      (await db.insert(users).values({ email, name: "Operator", passwordHash }).returning())[0];
    if (existing) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    }
    await db
      .insert(memberships)
      .values({ userId: user.id, workspaceId: workspace.id, role: "operator" })
      .onConflictDoNothing();
    operatorToken = (await login(email, "operator-local-only")).token;

    const clientsRes = await app.request("/clients", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    clientId = clients.find((c) => c.name === "Elmar HVAC")?.id ?? clients[0]!.id;

    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "google" }),
    });
    accountId = String(((await json(connect)).adAccount as { id: string }).id);
    await runAdAccountSync(accountId);
    const audit = await app.request(`/clients/${clientId}/audits`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ inline: true, adAccountId: accountId }),
    });
    const recs = ((await json(audit)).recommendations as { id: string; status: string }[]).filter(
      (row) => row.status === "proposed",
    );
    recommendationId = recs[0]!.id;
  });

  afterAll(async () => {
    try {
      if (ownerToken && accountId) {
        const unfreeze = await app.request(`/ad-accounts/${accountId}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ frozen: false }),
        });
        expect(unfreeze.status).toBe(200);
      }
    } finally {
      if (ownerToken) {
        const restore = await app.request("/workspace", {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ applyKillSwitch: true }),
        });
        expect(restore.status).toBe(200);
      }
      const workspace = await getDb().query.workspaces.findFirst({
        where: eq(workspaces.name, "Tharros Media"),
      });
      expect(workspace?.applyKillSwitch).toBe(true);
      await closeDb();
    }
  });

  async function recommendationStatus(id: string) {
    const res = await app.request(`/recommendations/${id}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = await json(res);
    return String((body.recommendation as { status?: string } | undefined)?.status ?? "");
  }

  it("returns 401 for unauthenticated approve/apply and a wrong internal key without changing state", async () => {
    const before = await recommendationStatus(recommendationId);
    const decide = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(decide.status).toBe(401);
    const apply = await app.request(`/recommendations/${recommendationId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(apply.status).toBe(401);
    const wrong = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cerevex-internal-key": "not-the-real-key" },
      body: JSON.stringify({ action: "authorize" }),
    });
    expect(wrong.status).toBe(401);
    expect(await recommendationStatus(recommendationId)).toBe(before);
  });

  it("lets an authenticated approver through while the kill switch blocks the write", async () => {
    const before = await recommendationStatus(recommendationId);
    const res = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(409);
    expect(String((await json(res)).error)).toMatch(/paused/i);
    const apply = await app.request(`/recommendations/${recommendationId}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(apply.status).not.toBe(401);
    expect(apply.status).not.toBe(403);
    expect(await recommendationStatus(recommendationId)).toBe(before);
  });

  it("blocks a non-allowlist operator from Approve", async () => {
    const res = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(403);
  });

  it("lets that operator Deny without writing platforms", async () => {
    const recs = await app.request(`/clients/${clientId}/recommendations`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const open = ((await json(recs)).recommendations as { id: string; status: string }[]).find(
      (row) => row.status === "proposed" && row.id !== recommendationId,
    );
    expect(open?.id).toBeTruthy();
    const deny = await app.request(`/recommendations/${open!.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny" }),
    });
    expect(deny.status).toBe(200);
    expect((await json(deny)).writes).toBe(false);
  });

  it("blocks Approve when the ad account is frozen (after pause is off)", async () => {
    try {
      const pause = await app.request("/workspace", {
        method: "PATCH",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ applyKillSwitch: false }),
      });
      expect(pause.status).toBe(200);
      const freeze = await app.request(`/ad-accounts/${accountId}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ frozen: true }),
      });
      expect(freeze.status).toBe(200);
      const res = await app.request(`/recommendations/${recommendationId}/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(res.status).toBe(409);
      expect(String((await json(res)).error)).toMatch(/frozen/i);
    } finally {
      let unfreezeStatus = 0;
      try {
        const unfreeze = await app.request(`/ad-accounts/${accountId}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ frozen: false }),
        });
        unfreezeStatus = unfreeze.status;
      } finally {
        const restore = await app.request("/workspace", {
          method: "PATCH",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ applyKillSwitch: true }),
        });
        expect(unfreezeStatus).toBe(200);
        expect(restore.status).toBe(200);
      }
    }
  });
});
