import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { connectionStatusLabel } from "@tharros/ads-shared";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { requeueFailedApplyJob, runApplyJob } from "@tharros/ads-shared/apply";
import {
  META_CONNECT_EXTEND_FAILED,
  META_CONNECT_INCOMPLETE,
  META_EXPIRING_WITHIN_MS,
  META_PERMISSION_MISSING,
  META_RATE_LIMITED,
  META_REFRESH_FAILED,
  META_TOKEN_EXPIRED,
  checkMetaConnection,
  metaAdPlatformConnector,
  scrubMetaSecrets,
} from "@tharros/ads-shared/connectors";
import { loadTokens, storeTokens } from "@tharros/ads-shared/credentials";
import { executeMutation } from "@tharros/ads-shared/mutate";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import {
  adAccounts,
  adEntities,
  applyJobs,
  auditLog,
  authorizations,
  decisions,
  oauthCredentials,
  oauthPendingConnections,
  recommendations,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { META_GRAPH_VERSION } from "@tharros/ads-shared";
import { exchangeCode } from "../src/oauth-exchange";
import { signOAuthState } from "../src/oauth-state";
import { toPublicAccount } from "../src/connect";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const SHORT = "m3-short-lived-token-value";
const LONG = "m3-long-lived-token-value";
const STORED = "m3-stored-token-value";
const APP_SECRET = "m3-app-secret-value";
const AUTH_CODE = "m3-auth-code-value";

function graphError(code: number, subcode: number | undefined, leaked: string) {
  return new Response(
    JSON.stringify({
      error: {
        message: `Error validating access token ${leaked}`,
        type: "OAuthException",
        code,
        ...(subcode === undefined ? {} : { error_subcode: subcode }),
        fbtrace_id: "trace-not-a-token",
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function spyConsole() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  return {
    text() {
      return JSON.stringify([warn.mock.calls, error.mock.calls, log.mock.calls, info.mock.calls]);
    },
    restore() {
      warn.mockRestore();
      error.mockRestore();
      log.mockRestore();
      info.mockRestore();
    },
  };
}

function assertNoSecrets(text: string) {
  expect(text).not.toContain(SHORT);
  expect(text).not.toContain(LONG);
  expect(text).not.toContain(STORED);
  expect(text).not.toContain(APP_SECRET);
  expect(text).not.toContain(AUTH_CODE);
}

describe("Meta token lifecycle", () => {
  let ownerId = "";
  let clientId = "";
  let workspaceId = "";
  const metaAppId = process.env.META_APP_ID;
  const metaAppSecret = process.env.META_APP_SECRET;

  beforeAll(async () => {
    await ensureScopedUser();
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    const me = await json(
      await app.request("/auth/me", { headers: { authorization: `Bearer ${owner.token}` } }),
    );
    ownerId = String((me.user as { id: string }).id);
    const clientsRes = await app.request("/clients", {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const clients = (await json(clientsRes)).clients as { id: string; name: string; workspaceId: string }[];
    const got = clients.find((row) => row.name === "Got Ductless");
    if (!got) throw new Error("Seed client missing");
    clientId = got.id;
    workspaceId = got.workspaceId;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (metaAppId === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = metaAppId;
    if (metaAppSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = metaAppSecret;
    await closeDb();
  });

  function configureMetaEnv() {
    process.env.META_APP_ID = "m3-test-app";
    process.env.META_APP_SECRET = APP_SECRET;
  }

  async function seedAccount(input: { expiresAt?: string; externalId: string }) {
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "meta",
        externalId: input.externalId,
        displayName: "M3 token",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "meta",
      label: "live",
      tokens: { accessToken: STORED, expiresAt: input.expiresAt, mock: false, tokenType: "long_lived_user" },
    });
    const [entity] = await getDb()
      .insert(adEntities)
      .values({
        workspaceId,
        clientId,
        adAccountId: account.id,
        platform: "meta",
        entityType: "campaign",
        externalId: `kept-${account.id}`,
        name: "Kept campaign",
        status: "active",
        rawJson: { source: "live" },
      })
      .returning();
    return { account, entity };
  }

  async function reconnectAudits(adAccountId: string) {
    return getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, adAccountId));
  }

  it("exchanges the code for a long-lived token and stores that token with expiresAt", async () => {
    configureMetaEnv();
    const logs = spyConsole();
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), body: String(init.body ?? "") });
      const body = String(init.body ?? "");
      if (body.includes("grant_type=fb_exchange_token")) {
        return jsonResponse({ access_token: LONG, expires_in: 5_184_000, token_type: "bearer", scope: "ads_read,ads_management" });
      }
      if (body.includes("code=")) {
        return jsonResponse({ access_token: SHORT, expires_in: 3_600, token_type: "bearer" });
      }
      return jsonResponse({ data: [{ id: "act_m3_fixture", account_id: "m3_fixture" }] });
    });

    const exchanged = await metaAdPlatformConnector.exchangeCode(AUTH_CODE);
    expect(exchanged.tokens.accessToken).toBe(LONG);
    expect(exchanged.tokens.accessToken).not.toBe(SHORT);
    expect(exchanged.tokens.tokenType).toBe("long_lived_user");
    expect(exchanged.tokens.grantedScopes).toEqual(["ads_read", "ads_management"]);
    const expiresAt = Date.parse(exchanged.tokens.expiresAt ?? "");
    expect(expiresAt).toBeGreaterThan(Date.now() + 5_000_000 * 1000);
    expect(expiresAt).toBeLessThan(Date.now() + 5_200_000 * 1000);

    expect(calls[0].url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    expect(calls[0].url).not.toContain(APP_SECRET);
    expect(calls[0].url).not.toContain(AUTH_CODE);
    expect(calls[1].body).toContain("grant_type=fb_exchange_token");
    expect(calls[1].body).toContain(encodeURIComponent(SHORT));
    expect(calls[1].url).not.toContain(SHORT);
    expect(calls[1].url).not.toContain(APP_SECRET);

    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "meta",
        externalId: `act_m3_store_${Date.now()}`,
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "meta",
      label: "live",
      tokens: exchanged.tokens,
    });
    const stored = await loadTokens(account.id);
    expect(stored?.accessToken).toBe(LONG);
    expect(stored?.expiresAt).toBe(exchanged.tokens.expiresAt);
    expect(stored?.tokenType).toBe("long_lived_user");
    assertNoSecrets(logs.text());
    logs.restore();
    await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
  });

  it("fails connect with a plain reason and saves nothing when the long-lived exchange fails", async () => {
    configureMetaEnv();
    const logs = spyConsole();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
      const body = String(init.body ?? "");
      if (body.includes("grant_type=fb_exchange_token")) {
        return graphError(190, 463, SHORT);
      }
      return jsonResponse({ access_token: SHORT, expires_in: 3600 });
    });

    const beforeCredentials = await getDb()
      .select({ id: oauthCredentials.id })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.clientId, clientId));
    const beforePending = await getDb()
      .select({ id: oauthPendingConnections.id })
      .from(oauthPendingConnections)
      .where(eq(oauthPendingConnections.clientId, clientId));

    await expect(metaAdPlatformConnector.exchangeCode(AUTH_CODE)).rejects.toThrow(META_CONNECT_EXTEND_FAILED);
    await expect(exchangeCode("meta", AUTH_CODE)).rejects.toThrow(META_CONNECT_EXTEND_FAILED);

    const state = await signOAuthState({ userId: ownerId, clientId, platform: "meta" });
    const callback = await app.request(`/oauth/meta/callback?code=${AUTH_CODE}&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(302);
    const location = callback.headers.get("location") ?? "";
    expect(location).toMatch(/oauth_error=exchange_failed/);
    assertNoSecrets(location);
    assertNoSecrets(logs.text());

    const afterCredentials = await getDb()
      .select({ id: oauthCredentials.id })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.clientId, clientId));
    const afterPending = await getDb()
      .select({ id: oauthPendingConnections.id })
      .from(oauthPendingConnections)
      .where(eq(oauthPendingConnections.clientId, clientId));
    expect(afterCredentials.map((row) => row.id).sort()).toEqual(beforeCredentials.map((row) => row.id).sort());
    expect(afterPending.map((row) => row.id).sort()).toEqual(beforePending.map((row) => row.id).sort());
    logs.restore();
  });

  it("does not return the stored token when refresh fails", async () => {
    configureMetaEnv();
    const logs = spyConsole();
    const stored = { accessToken: STORED, expiresAt: new Date(Date.now() + 60_000).toISOString(), mock: false };
    vi.stubGlobal("fetch", async () => {
      throw new Error(
        `connect failed https://graph.facebook.com/oauth/access_token?fb_exchange_token=${STORED}&client_secret=${APP_SECRET}`,
      );
    });
    await expect(metaAdPlatformConnector.refreshTokens(stored)).rejects.toThrow(META_REFRESH_FAILED);

    vi.stubGlobal("fetch", async () => jsonResponse({ token_type: "bearer" }));
    await expect(metaAdPlatformConnector.refreshTokens(stored)).rejects.toThrow(META_REFRESH_FAILED);

    vi.stubGlobal("fetch", async () => graphError(190, 460, STORED));
    const expired = metaAdPlatformConnector.refreshTokens(stored);
    await expect(expired).rejects.toThrow(META_TOKEN_EXPIRED);
    await expect(expired).rejects.not.toEqual(stored);

    delete process.env.META_APP_SECRET;
    await expect(metaAdPlatformConnector.refreshTokens(stored)).rejects.toThrow(META_REFRESH_FAILED);
    assertNoSecrets(logs.text());
    logs.restore();
  });

  it.each([
    ["458", 458],
    ["460", 460],
    ["463", 463],
    ["no subcode", undefined],
    ["other subcode 467", 467],
  ] as const)("Graph 190 %s marks Needs reconnect once and does not retry", async (_label, subcode) => {
    configureMetaEnv();
    const logs = spyConsole();
    const { account, entity } = await seedAccount({
      externalId: `act_m3_190_${subcode ?? "none"}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    vi.stubGlobal("fetch", async (url: string) => {
      expect(String(url)).not.toContain(STORED);
      return graphError(190, subcode, STORED);
    });
    try {
      const first = await runAdAccountSync(account.id);
      expect(first.status).toBe("error");
      expect(first.lastError).toBe(META_TOKEN_EXPIRED);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("needs_reconnect");
      expect(row?.lastError).toBe(META_TOKEN_EXPIRED);
      const tokens = await loadTokens(account.id);
      expect(toPublicAccount(row!, tokens).connectionStatus).toBe("needs_reconnect");
      expect(connectionStatusLabel(toPublicAccount(row!, tokens).connectionStatus)).toBe("Needs reconnect");
      const kept = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entity.id) });
      expect(kept?.status).toBe("active");

      const audits = (await reconnectAudits(account.id)).filter((audit) => audit.action === "meta.reconnect_required");
      expect(audits).toHaveLength(1);
      assertNoSecrets(JSON.stringify(audits));
      expect(audits[0]?.payloadJson).toMatchObject({ platform: "meta", code: META_TOKEN_EXPIRED });

      const second = await runAdAccountSync(account.id);
      expect(second.lastError).toBe(META_TOKEN_EXPIRED);
      const again = (await reconnectAudits(account.id)).filter((audit) => audit.action === "meta.reconnect_required");
      expect(again).toHaveLength(1);
      assertNoSecrets(logs.text());
      assertNoSecrets(first.lastError ?? "");
    } finally {
      logs.restore();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("treats Graph 4 and 17 as retry later, not reconnect", async () => {
    configureMetaEnv();
    for (const code of [4, 17]) {
      const { account, entity } = await seedAccount({
        externalId: `act_m3_rate_${code}_${Date.now()}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      vi.stubGlobal("fetch", async () => graphError(code, undefined, STORED));
      await expect(runAdAccountSync(account.id)).rejects.toThrow(META_RATE_LIMITED);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(row?.connectionStatus).not.toBe("syncing");
      expect(row?.lastError).toBe(META_RATE_LIMITED);
      expect(toPublicAccount(row!, await loadTokens(account.id)).connectionStatus).not.toBe("needs_reconnect");
      const audits = (await reconnectAudits(account.id)).filter((audit) => audit.action === "meta.reconnect_required");
      expect(audits).toHaveLength(0);
      const kept = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entity.id) });
      expect(kept?.status).toBe("active");
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("maps Graph 10 and 200-299 to meta.permission_missing", async () => {
    configureMetaEnv();
    for (const code of [10, 200, 299]) {
      const { account } = await seedAccount({
        externalId: `act_m3_perm_${code}_${Date.now()}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      vi.stubGlobal("fetch", async () => graphError(code, undefined, STORED));
      const result = await runAdAccountSync(account.id);
      expect(result.status).toBe("error");
      expect(result.lastError).toBe(META_PERMISSION_MISSING);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      expect(toPublicAccount(row!, await loadTokens(account.id)).connectionStatus).not.toBe("needs_reconnect");
      expect(result.lastError).not.toContain(STORED);
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("refreshes a near-expiry token before apply", async () => {
    configureMetaEnv();
    const logs = spyConsole();
    const near = await seedAccount({
      externalId: `act_m3_refresh_${Date.now()}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const fresh = "m3-refreshed-token-value";
    const calls: { url: string; authorization: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), authorization: headers.authorization ?? "" });
      const body = String(init.body ?? "");
      if (body.includes("grant_type=fb_exchange_token")) {
        return jsonResponse({ access_token: fresh, expires_in: 5_184_000 });
      }
      return jsonResponse({ id: near.entity.externalId, name: "Kept campaign", status: "ACTIVE", daily_budget: "1000" });
    });
    try {
      const outcome = await executeMutation({
        adAccountId: near.account.id,
        platform: "meta",
        accountExternalId: near.account.externalId,
        mutation: {
          platform: "meta",
          action: "pause",
          target: { entityType: "campaign", externalId: near.entity.externalId, name: near.entity.name },
          payload: {},
        },
      });
      expect(outcome.status).toBe("applied");
      expect(outcome.writes).toBe(true);
      expect(calls.some((call) => call.url.includes("/oauth/access_token"))).toBe(true);
      const write = calls.find((call) => call.url.endsWith(`/${near.entity.externalId}`));
      expect(write?.authorization).toBe(`Bearer ${fresh}`);
      expect(write?.url).not.toContain(fresh);
      const stored = await loadTokens(near.account.id);
      expect(stored?.accessToken).toBe(fresh);
      expect(stored?.tokenType).toBe("long_lived_user");
      const extended = (await reconnectAudits(near.account.id)).filter((audit) => audit.action === "meta.token_extended");
      expect(extended).toHaveLength(1);
      assertNoSecrets(JSON.stringify(extended));
      expect(extended[0]?.payloadJson).toMatchObject({ platform: "meta" });
      expect(JSON.stringify(extended)).not.toContain(fresh);
    } finally {
      logs.restore();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, near.account.id));
    }
  });

  it("stops apply on Graph 190, writes one reconnect audit, and does not requeue", async () => {
    configureMetaEnv();
    const logs = spyConsole();
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    const kill = workspace?.applyKillSwitch;
    const { account, entity } = await seedAccount({
      externalId: `act_m3_apply190_${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      expect(String(url)).not.toContain(STORED);
      return graphError(190, 458, STORED);
    });
    try {
      await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
      const [rec] = await getDb()
        .insert(recommendations)
        .values({
          workspaceId,
          clientId,
          adAccountId: account.id,
          type: "pause_waste",
          title: "Pause must stop when the Meta sign-in is dead",
          rationale: "Graph 190",
          risk: "low",
          evidenceJson: { writes: false },
          proposedMutationsJson: [
            {
              platform: "meta",
              action: "pause",
              target: { entityType: "campaign", externalId: entity.externalId, name: entity.name },
              payload: {},
            },
          ],
          status: "authorized",
          schemaVersion: "1",
        })
        .returning();
      const owner = await getDb().query.users.findFirst({ where: eq(users.id, ownerId) });
      if (!owner) throw new Error("Owner missing");
      const [decision] = await getDb()
        .insert(decisions)
        .values({
          workspaceId,
          clientId,
          recommendationId: rec.id,
          userId: owner.id,
          action: "authorize",
        })
        .returning();
      const [authorization] = await getDb()
        .insert(authorizations)
        .values({
          workspaceId,
          clientId,
          recommendationId: rec.id,
          decisionId: decision.id,
          scopeJson: {},
        })
        .returning();
      const [job] = await getDb()
        .insert(applyJobs)
        .values({
          workspaceId,
          clientId,
          authorizationId: authorization.id,
          idempotencyKey: `apply:${rec.id}`,
          status: "queued",
          requestJson: {},
        })
        .returning();
      const ran = await runApplyJob(job.id);
      expect(ran.applyJob.status).toBe("failed");
      expect(ran.writes).toBe(false);
      expect(ran.applyJob.error).toBe(META_TOKEN_EXPIRED);
      expect(JSON.stringify(ran.applyJob.response)).not.toContain(STORED);
      expect(calls.length).toBe(1);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("needs_reconnect");
      expect(connectionStatusLabel(toPublicAccount(row!, await loadTokens(account.id)).connectionStatus)).toBe(
        "Needs reconnect",
      );
      const audits = (await reconnectAudits(account.id)).filter((audit) => audit.action === "meta.reconnect_required");
      expect(audits).toHaveLength(1);
      const again = await runApplyJob(job.id);
      expect(again.applyJob.status).toBe("failed");
      expect((await reconnectAudits(account.id)).filter((audit) => audit.action === "meta.reconnect_required")).toHaveLength(1);
      const requeued = await requeueFailedApplyJob(job.id);
      expect(requeued.ok).toBe(false);
      if (!requeued.ok) expect(requeued.reason).toBe("not_repeatable");
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
      await getDb().update(workspaces).set({ applyKillSwitch: kill ?? true }).where(eq(workspaces.id, workspaceId));
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("checks expiry before apply and does not call Meta with a stored expired token", async () => {
    configureMetaEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { account, entity } = await seedAccount({
      externalId: `act_m3_expired_${Date.now()}`,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    try {
      const outcome = await executeMutation({
        adAccountId: account.id,
        platform: "meta",
        accountExternalId: account.externalId,
        mutation: {
          platform: "meta",
          action: "pause",
          target: { entityType: "campaign", externalId: entity.externalId, name: entity.name },
          payload: {},
        },
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.writes).toBe(false);
      expect(outcome.reason).toBe(META_TOKEN_EXPIRED);
      expect(fetchMock).not.toHaveBeenCalled();
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).toBe("needs_reconnect");
      expect((await reconnectAudits(account.id)).filter((audit) => audit.action === "meta.reconnect_required")).toHaveLength(1);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("reports expiring inside 14 days and Needs reconnect after expiresAt", async () => {
    configureMetaEnv();
    const now = new Date("2026-10-06T12:00:00.000Z");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${STORED}`);
      expect(String(url)).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/me?fields=id`);
      expect(String(url)).not.toContain(STORED);
      return jsonResponse({ id: "1" });
    });
    const within = new Date(now.getTime() + META_EXPIRING_WITHIN_MS).toISOString();
    const expiring = await checkMetaConnection({ accessToken: STORED, expiresAt: within, mock: false }, now);
    expect(expiring.state).toBe("expiring");
    expect(expiring.expiresAt).toBe(within);
    expect(expiring.retry).toBe(false);

    const outside = new Date(now.getTime() + META_EXPIRING_WITHIN_MS + 1000).toISOString();
    const fresh = await checkMetaConnection({ accessToken: STORED, expiresAt: outside, mock: false }, now);
    expect(fresh.state).toBe("connected");

    const calls = vi.fn();
    vi.stubGlobal("fetch", calls);
    const past = new Date(now.getTime() - 1000).toISOString();
    const expired = await checkMetaConnection({ accessToken: STORED, expiresAt: past, mock: false }, now);
    expect(expired.state).toBe("needs_reconnect");
    expect(expired.code).toBe(META_TOKEN_EXPIRED);
    expect(expired.retry).toBe(false);
    expect(calls).not.toHaveBeenCalled();

    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    const missing = await checkMetaConnection({ accessToken: STORED, expiresAt: outside, mock: false }, now);
    expect(missing.state).toBe("not_configured");
    expect(missing.code).toBe("meta.not_configured");
  });

  it("scrubs tokens out of error strings", () => {
    const raw = `https://graph.facebook.com/oauth/access_token?client_secret=${APP_SECRET}&code=${AUTH_CODE}&fb_exchange_token=${SHORT} Bearer ${LONG} ${STORED}`;
    const scrubbed = scrubMetaSecrets(raw, [SHORT, LONG, STORED, APP_SECRET, AUTH_CODE]);
    assertNoSecrets(scrubbed);
    expect(scrubbed).toContain("[redacted]");
    expect(META_CONNECT_INCOMPLETE).not.toContain("token");
  });
});
