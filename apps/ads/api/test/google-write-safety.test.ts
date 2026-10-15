import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { isApplySafetyCapability, resolveWorkspaceCapabilities } from "@cerevex/contracts";
import {
  GOOGLE_ADS_API_VERSION,
  defaultCapabilityFlags,
  settingsJsonWithCapabilityOverrides,
} from "@tharros/ads-shared";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb, getPool } from "@tharros/ads-shared/db";
import { applyClaimHooks, runApplyJob } from "@tharros/ads-shared/apply";
import { applyBlockMessage, evaluateApplyGate } from "@tharros/ads-shared/apply-gate";
import { GOOGLE_RATE_LIMITED, GoogleRetryLater, googleAdPlatformConnector } from "@tharros/ads-shared/connectors";
import { storeTokens } from "@tharros/ads-shared/credentials";
import { applyViaConnector, executeMutation } from "@tharros/ads-shared/mutate";
import {
  adAccounts,
  applyJobs,
  auditLog,
  authorizations,
  clientAuditLog,
  decisions,
  memberships,
  recommendations,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const TOKEN = "g5-live-token-not-for-logs";
const CUSTOMER = "1234567890";
const PAUSE_OR_BID = "Google apply is pause or bid only. Nothing was written.";

type GoogleAction =
  | "pause"
  | "update_bid"
  | "update_budget"
  | "add_negative"
  | "exclude_placement"
  | "create_ad"
  | "add_keyword"
  | "tighten_geo"
  | "resume"
  | "review";

function mutation(
  action: GoogleAction,
  payload: Record<string, unknown> = {},
  entityType = "campaign",
  externalId = "111",
) {
  return {
    platform: "google" as const,
    action,
    target: { entityType, externalId, name: "HVAC" },
    payload,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function googleOn() {
  return { ...defaultCapabilityFlags(), "apply.google": "on" as const, "sync.live": "on" as const };
}

describe("Google pause paths and refused writes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps apply.google hidden, owner-only, and off when the env kill is set", () => {
    expect(isApplySafetyCapability("apply.google")).toBe(true);
    expect(defaultCapabilityFlags()["apply.google"]).toBe("hidden");
    const killed = resolveWorkspaceCapabilities(
      { capabilities: { "apply.google": "on" } },
      { CAPABILITY_KILL: "apply.google" },
    );
    expect(killed["apply.google"]).toBe("hidden");
    const gate = evaluateApplyGate({
      expectedWorkspaceId: "11111111-1111-1111-1111-111111111111",
      workspace: { applyKillSwitch: false },
      authorization: {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
      platform: "google",
      capabilities: killed,
      mock: false,
    });
    expect(gate).toEqual({ allowed: false, blocked: "apply_google_hidden", writes: false });
  });

  it.each([
    ["campaign", "111", undefined, "campaignOperation", `customers/${CUSTOMER}/campaigns/111`],
    ["ad_group", "220", undefined, "adGroupOperation", `customers/${CUSTOMER}/adGroups/220`],
    ["ad", "320", "220", "adGroupAdOperation", `customers/${CUSTOMER}/adGroupAds/220~320`],
  ] as const)("pauses a %s on its own Ads resource and status field", async (entityType, externalId, adGroupId, operation, resourceName) => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")) });
      return jsonResponse({ mutateOperationResponses: [{}] });
    });
    const outcome = await googleAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause", {}, entityType, externalId),
      live: {
        externalId,
        entityType,
        status: "enabled",
        currency: "USD",
        ...(adGroupId ? { parentExternalId: adGroupId } : {}),
      },
      accountExternalId: `customers/${CUSTOMER.slice(0, 3)}-${CUSTOMER.slice(3, 6)}-${CUSTOMER.slice(6)}`,
    });
    expect(outcome).toMatchObject({ status: "applied", writes: true, mode: "live" });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe(`/${GOOGLE_ADS_API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`);
    const update = (calls[0].body as { mutateOperations: Record<string, { update: { resourceName: string; status: string }; updateMask: string }>[] })
      .mutateOperations[0][operation];
    expect(update.update).toEqual({ resourceName, status: "PAUSED" });
    expect(update.updateMask).toBe("status");
    expect(JSON.stringify(calls[0].body)).not.toContain(TOKEN);
  });

  it("reads the ad group from Google and pauses that ad group ad", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const href = String(url);
      const body = String(init.body ?? "");
      calls.push({ url: href, body });
      if (href.includes("googleAds:search")) {
        return jsonResponse({
          results: [{ adGroupAd: { status: "ENABLED" }, adGroup: { id: "220" }, customer: { currencyCode: "USD" } }],
        });
      }
      return jsonResponse({ mutateOperationResponses: [{}] });
    });
    const outcome = await applyViaConnector({
      platform: "google",
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause", {}, "ad", "320"),
      accountExternalId: CUSTOMER,
    });
    expect(outcome).toMatchObject({ status: "applied", writes: true });
    expect(outcome.before).toMatchObject({ status: "enabled", unit: "status" });
    expect(outcome.after).toMatchObject({ status: "paused", unit: "status" });
    expect(calls[0]?.body).toContain("ad_group_ad.status");
    expect(calls[0]?.body).toContain("ad_group.id");
    const mutate = JSON.parse(calls[1].body) as {
      mutateOperations: Array<{ adGroupAdOperation: { update: { resourceName: string; status: string }; updateMask: string } }>;
    };
    expect(mutate.mutateOperations[0].adGroupAdOperation).toEqual({
      update: { resourceName: `customers/${CUSTOMER}/adGroupAds/220~320`, status: "PAUSED" },
      updateMask: "status",
    });
  });

  it("refuses an ad pause when the live read is missing or ambiguous", async () => {
    for (const results of [[], [{ adGroupAd: { status: "ENABLED" }, adGroup: { id: "220" } }, { adGroupAd: { status: "ENABLED" }, adGroup: { id: "221" } }]]) {
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        calls.push(String(url));
        return jsonResponse({ results });
      });
      const outcome = await applyViaConnector({
        platform: "google",
        tokens: { accessToken: TOKEN, mock: false },
        mutation: mutation("pause", {}, "ad", "320"),
        accountExternalId: CUSTOMER,
      });
      expect(outcome).toMatchObject({ status: "failed", writes: false, reason: "Missing ad group. Nothing was written." });
      expect(calls.some((url) => url.includes("googleAds:mutate"))).toBe(false);
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "update_budget",
    "add_negative",
    "exclude_placement",
    "create_ad",
    "add_keyword",
    "tighten_geo",
    "resume",
    "review",
  ] as const)("refuses %s and does not call Google", async (action) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await googleAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation(action, { amount: 40, text: "free", placement: "example.com", headline: "Visit" }),
      live: { externalId: "111", entityType: "campaign", status: "enabled", dailyBudget: 50, budgetNative: "50000000" },
      accountExternalId: CUSTOMER,
    });
    expect(outcome).toMatchObject({ status: "failed", writes: false, reason: PAUSE_OR_BID });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a second pause or a matching bid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const paused = await googleAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause"),
      live: { externalId: "111", entityType: "campaign", status: "paused", currency: "USD" },
      accountExternalId: CUSTOMER,
    });
    expect(paused).toMatchObject({ status: "already_applied", writes: false });
    expect(paused.before).toEqual(paused.after);
    const bid = await googleAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("update_bid", { amount: 1.5 }, "ad_group", "220"),
      live: { externalId: "220", entityType: "ad_group", status: "enabled", bidAmount: 1.5, bidNative: "1500000", currency: "USD" },
      accountExternalId: CUSTOMER,
    });
    expect(bid).toMatchObject({ status: "already_applied", writes: false });
    expect(bid.before).toMatchObject({ amount: "1500000" });
    expect(bid.after).toMatchObject({ amount: "1500000" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "rejected"],
    [500, "down"],
    [429, `limited ${TOKEN}`],
  ] as const)("handles Google mutate %s without a second call", async (status, body) => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(body, { status });
    });
    const attempt = googleAdPlatformConnector.applyLive({
      tokens: { accessToken: TOKEN, mock: false },
      mutation: mutation("pause"),
      live: { externalId: "111", entityType: "campaign", status: "enabled" },
      accountExternalId: CUSTOMER,
    });
    if (status === 429) await expect(attempt).rejects.toBeInstanceOf(GoogleRetryLater);
    else if (status === 500) await expect(attempt).rejects.toMatchObject({ name: "UnconfirmedPlatformWriteError" });
    else await expect(attempt).rejects.toThrow(/Google Ads write failed \(400\)/);
    expect(calls).toBe(1);
    await expect(attempt).rejects.toThrow();
    try {
      await attempt;
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN);
    }
  });
});

describe("apply.google approve, owner, and write-time gate", () => {
  let ownerToken = "";
  let ownerId = "";
  let clientId = "";
  let workspaceId = "";
  let kill: boolean | undefined;
  let settingsSnapshot: unknown;
  const envBefore = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  };

  beforeAll(async () => {
    await ensureScopedUser();
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    ownerToken = owner.token;
    const me = await json(await app.request("/auth/me", { headers: { authorization: `Bearer ${ownerToken}` } }));
    ownerId = String((me.user as { id: string }).id);
    const clients = (await json(await app.request("/clients", { headers: { authorization: `Bearer ${ownerToken}` } })))
      .clients as { id: string; name: string; workspaceId: string }[];
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
    applyClaimHooks.beforeWrite = undefined;
    applyClaimHooks.afterWrite = undefined;
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

  function configureGoogle() {
    process.env.GOOGLE_CLIENT_ID = "g5-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "g5-client-secret";
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  }

  async function setFlag(state: "hidden" | "recommend_only" | "on", token = ownerToken) {
    return app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "apply.google": state }, workspaceId }),
    });
  }

  async function openGoogleApply() {
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    await getDb()
      .update(workspaces)
      .set({
        applyKillSwitch: false,
        settingsJson: settingsJsonWithCapabilityOverrides((workspace?.settingsJson ?? {}) as Record<string, unknown>, {
          "apply.google": "on",
          "sync.live": "on",
          "apply.create_entity": "on",
          "apply.budget": "on",
        }),
      })
      .where(eq(workspaces.id, workspaceId));
  }

  async function seedLiveAccount(action: GoogleAction = "pause", entityType = "campaign", externalId = "88001") {
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "google",
        externalId: `customers/880${Date.now().toString().slice(-7)}`,
        displayName: "G5 write safety",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: "google",
      label: "live",
      tokens: { accessToken: TOKEN, mock: false },
    });
    const proposed = [mutation(action, action === "pause" ? {} : { amount: 40 }, entityType, externalId)];
    const [rec] = await getDb()
      .insert(recommendations)
      .values({
        workspaceId,
        clientId,
        adAccountId: account.id,
        type: "pause_waste",
        title: "Google stays unsent",
        rationale: "apply.google gates the write.",
        risk: "low",
        evidenceJson: { writes: false },
        proposedMutationsJson: proposed,
        status: "proposed",
        schemaVersion: "1",
      })
      .returning();
    return { account, rec, proposed };
  }

  async function queueJob(accountId: string, proposed: ReturnType<typeof mutation>[]) {
    const [rec] = await getDb()
      .insert(recommendations)
      .values({
        workspaceId,
        clientId,
        adAccountId: accountId,
        type: "pause_waste",
        title: "Queued Google pause",
        rationale: "One write.",
        risk: "low",
        evidenceJson: {},
        proposedMutationsJson: proposed,
        status: "authorized",
        schemaVersion: "1",
      })
      .returning();
    const [decision] = await getDb()
      .insert(decisions)
      .values({ workspaceId, clientId, recommendationId: rec.id, userId: ownerId, action: "authorize" })
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
        requestJson: { proposedMutations: proposed },
      })
      .returning();
    return { rec, job };
  }

  it("lets only the owner turn apply.google on, and audits enable and disable", async () => {
    const email = "operator.g5@tharrosmedia.com";
    const passwordHash = await hash("operator-g5-local", 10);
    const existing = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ??
      (await getDb().insert(users).values({ email, name: "G5 operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await getDb().update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await getDb()
      .insert(memberships)
      .values({ userId: operator.id, workspaceId, role: "operator" })
      .onConflictDoNothing();
    const operatorToken = (await login(email, "operator-g5-local")).token;

    const operatorOn = await setFlag("on", operatorToken);
    expect(operatorOn.status).toBe(403);
    const stillHidden = resolveWorkspaceCapabilities(
      (await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))?.settingsJson,
    );
    expect(stillHidden["apply.google"]).toBe("hidden");
    const refused = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, workspaceId))).filter(
      (row) => row.action === "apply.google_enabled" && row.actorId === operator.id,
    );
    expect(refused).toHaveLength(0);

    const ownerOn = await setFlag("on");
    expect(ownerOn.status).toBe(200);
    const enabled = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, workspaceId))).filter(
      (row) => row.action === "apply.google_enabled",
    );
    const enabledRow = enabled.find((row) => row.actorId === ownerId);
    expect(enabledRow?.payloadJson).toMatchObject({ capability: "apply.google", to: "on" });
    expect(JSON.stringify(enabled)).not.toContain(TOKEN);

    const ownerOff = await setFlag("hidden");
    expect(ownerOff.status).toBe(200);
    const disabled = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, workspaceId))).filter(
      (row) => row.action === "apply.google_disabled",
    );
    expect(disabled.some((row) => row.actorId === ownerId)).toBe(true);
    expect(disabled.some((row) => {
      const payload = row.payloadJson as { capability?: string; from?: string; to?: string };
      return payload.capability === "apply.google" && payload.from === "on" && payload.to === "hidden";
    })).toBe(true);
  });

  it("records Approve and writes nothing when apply.google is hidden or recommend-only", async () => {
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
        expect(body.reason).toBe(state === "hidden" ? "apply_google_hidden" : "apply_google_recommend_only");
        expect(body.note).toBe(
          applyBlockMessage(state === "hidden" ? "apply_google_hidden" : "apply_google_recommend_only"),
        );
        expect((body.recommendation as { status: string }).status).toBe("authorized");
        const authorizationId = (body.authorization as { id: string }).id;
        const jobs = await getDb().select().from(applyJobs).where(eq(applyJobs.authorizationId, authorizationId));
        expect(jobs).toHaveLength(0);
        const direct = await executeMutation({
          adAccountId: account.id,
          platform: "google",
          accountExternalId: account.externalId,
          mutation: mutation("pause", {}, "campaign", "88001"),
          capabilities:
            state === "hidden"
              ? defaultCapabilityFlags()
              : { ...defaultCapabilityFlags(), "apply.google": "recommend_only" },
        });
        expect(direct.writes).toBe(false);
        expect(direct.reason).toBe(
          applyBlockMessage(state === "hidden" ? "apply_google_hidden" : "apply_google_recommend_only"),
        );
      } finally {
        await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still writes nothing when the kill switch is on, even if apply.google is on", async () => {
    configureGoogle();
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
      const direct = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation: mutation("pause"),
        capabilities: googleOn(),
      });
      expect(direct).toMatchObject({ status: "failed", writes: false, reason: applyBlockMessage("apply_kill_switch") });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("re-reads the kill switch between the live read and the write", async () => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount();
    let searches = 0;
    let mutates = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const href = String(url);
      if (href.includes("googleAds:search")) {
        searches += 1;
        await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
        return jsonResponse({
          results: [{ campaign: { status: "ENABLED" }, customer: { currencyCode: "USD" } }],
        });
      }
      if (href.includes("googleAds:mutate")) mutates += 1;
      return jsonResponse({ mutateOperationResponses: [{}] });
    });
    try {
      const { job } = await queueJob(account.id, [mutation("pause", {}, "campaign", "88001")]);
      const ran = await runApplyJob(job.id);
      expect(searches).toBe(1);
      expect(mutates).toBe(0);
      expect(ran.writes).toBe(false);
      expect(ran.outcomes[0]).toMatchObject({
        status: "failed",
        writes: false,
        reason: applyBlockMessage("apply_kill_switch"),
      });
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("denies the re-read when the workspace row is gone", async () => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount();
    const ghost = "22222222-2222-4222-8222-222222222222";
    const read = vi.spyOn(googleAdPlatformConnector, "readLiveEntityState");
    const apply = vi.spyOn(googleAdPlatformConnector, "applyLive").mockResolvedValue({
      action: "pause",
      platform: "google",
      target: { entityType: "campaign", externalId: "88001", name: "HVAC" },
      status: "applied",
      mode: "live",
      writes: true,
    });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("UPDATE os.ad_accounts SET workspace_id = $1 WHERE id = $2", [ghost, account.id]);
      await client.query("COMMIT");
      const outcome = await applyViaConnector({
        platform: "google",
        tokens: { accessToken: TOKEN, mock: false },
        mutation: mutation("pause", {}, "campaign", "88001"),
        accountExternalId: account.externalId,
        adAccountId: account.id,
      });
      expect(outcome).toMatchObject({
        status: "failed",
        writes: false,
        reason: applyBlockMessage("workspace_not_found"),
      });
      expect(read).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      apply.mockRestore();
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("UPDATE os.ad_accounts SET workspace_id = $1 WHERE id = $2", [workspaceId, account.id]);
      await client.query("COMMIT");
      client.release();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("refuses a disallowed change in applyViaConnector before the live read", async () => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount();
    const read = vi.spyOn(googleAdPlatformConnector, "readLiveEntityState");
    const apply = vi.spyOn(googleAdPlatformConnector, "applyLive");
    try {
      const outcome = await applyViaConnector({
        platform: "google",
        tokens: { accessToken: TOKEN, mock: false },
        mutation: mutation("update_budget", { amount: 40 }),
        accountExternalId: account.externalId,
        adAccountId: account.id,
      });
      expect(outcome).toMatchObject({ status: "failed", writes: false, reason: PAUSE_OR_BID });
      expect(read).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      apply.mockRestore();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("refuses a disallowed change in executeMutation before Google is called", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const { account } = await seedLiveAccount();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const outcome = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation: mutation("update_budget", { amount: 40 }),
        capabilities: googleOn(),
      });
      expect(outcome).toMatchObject({ status: "failed", writes: false, reason: PAUSE_OR_BID });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("re-reads the kill switch and apply.google before the write", async () => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("googleAds:search")) {
        return jsonResponse({
          results: [{ campaign: { status: "ENABLED" }, customer: { currencyCode: "USD" } }],
        });
      }
      return jsonResponse({ mutateOperationResponses: [{}] });
    });
    try {
      for (const flip of ["kill", "flag"] as const) {
        calls.length = 0;
        const proposed = [mutation("pause", {}, "campaign", "88001")];
        const { job } = await queueJob(account.id, proposed);
        applyClaimHooks.beforeWrite = async () => {
          if (flip === "kill") {
            await getDb().update(workspaces).set({ applyKillSwitch: true }).where(eq(workspaces.id, workspaceId));
          } else {
            await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
            const current = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
            await getDb()
              .update(workspaces)
              .set({
                settingsJson: settingsJsonWithCapabilityOverrides((current?.settingsJson ?? {}) as Record<string, unknown>, {
                  "apply.google": "hidden",
                }),
              })
              .where(eq(workspaces.id, workspaceId));
          }
        };
        const ran = await runApplyJob(job.id);
        expect(ran.writes).toBe(false);
        expect(ran.outcomes[0]).toMatchObject({
          status: "failed",
          writes: false,
          reason:
            flip === "kill"
              ? applyBlockMessage("apply_kill_switch")
              : applyBlockMessage("apply_google_hidden"),
        });
        expect(calls.filter((url) => url.includes("googleAds:mutate"))).toHaveLength(0);
        await openGoogleApply();
      }
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("writes one pause, audits before and after, and does not apply the same job twice", async () => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount();
    const mutates: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const href = String(url);
      if (href.includes("googleAds:mutate")) mutates.push(String(init.body ?? ""));
      if (href.includes("googleAds:search")) {
        return jsonResponse({
          results: [{ campaign: { status: "ENABLED" }, customer: { currencyCode: "USD" } }],
        });
      }
      return jsonResponse({ mutateOperationResponses: [{}] });
    });
    try {
      const proposed = [mutation("pause", {}, "campaign", "88001")];
      const { rec, job } = await queueJob(account.id, proposed);
      const first = await runApplyJob(job.id);
      expect(first.writes).toBe(true);
      expect(first.outcomes[0]).toMatchObject({
        status: "applied",
        writes: true,
        before: { status: "enabled", unit: "status" },
        after: { status: "paused", unit: "status" },
      });
      expect(mutates).toHaveLength(1);
      expect(mutates[0]).toContain(`customers/${account.externalId.replace(/\D/g, "")}/campaigns/88001`);
      expect(mutates[0]).toContain('"status":"PAUSED"');
      const audits = await getDb().select().from(clientAuditLog).where(eq(clientAuditLog.entityId, rec.id));
      const applied = audits.filter((row) => row.action === "applied");
      expect(applied).toHaveLength(1);
      const payload = applied[0]?.payloadJson as { before?: unknown; after?: { outcomes?: Array<{ before?: { status?: string }; after?: { status?: string } }> } };
      expect(payload.before).toEqual(proposed);
      expect(payload.after?.outcomes?.[0]?.before?.status).toBe("enabled");
      expect(payload.after?.outcomes?.[0]?.after?.status).toBe("paused");
      expect(JSON.stringify(applied)).not.toContain(TOKEN);

      const second = await runApplyJob(job.id);
      expect(second.replayed).toBe(true);
      expect(second.writes).toBe(true);
      expect(mutates).toHaveLength(1);
      const appliedAgain = (await getDb().select().from(clientAuditLog).where(eq(clientAuditLog.entityId, rec.id))).filter(
        (row) => row.action === "applied",
      );
      expect(appliedAgain).toHaveLength(1);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it.each(["update_budget", "create_ad"] as const)("rejects %s on the execute path even when that family flag is on", async (action) => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount(action, action === "create_ad" ? "ad_group" : "campaign", "88001");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const outcome = await executeMutation({
        adAccountId: account.id,
        platform: "google",
        accountExternalId: account.externalId,
        mutation: mutation(action, { amount: 40, headline: "Visit", body: "Book", proposedName: "Visit" }, action === "create_ad" ? "ad_group" : "campaign", "88001"),
        capabilities: { ...googleOn(), "apply.create_entity": "on", "apply.budget": "on" },
      });
      expect(outcome).toMatchObject({ status: "failed", writes: false, reason: PAUSE_OR_BID });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it.each([
    [400, false],
    [500, "unknown"],
    [429, false],
  ] as const)("stores Google mutate %s without a second apply", async (status, writes) => {
    configureGoogle();
    await openGoogleApply();
    const { account } = await seedLiveAccount();
    let mutates = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const href = String(url);
      if (href.includes("googleAds:search")) {
        return jsonResponse({ results: [{ campaign: { status: "ENABLED" }, customer: { currencyCode: "USD" } }] });
      }
      mutates += 1;
      return new Response(status === 400 ? "no" : `busy ${TOKEN}`, { status });
    });
    try {
      const { rec, job } = await queueJob(account.id, [mutation("pause", {}, "campaign", "88001")]);
      const ran = await runApplyJob(job.id);
      expect(mutates).toBe(1);
      expect(ran.writes).toBe(false);
      const stored = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
      const response = stored?.responseJson as { writes?: unknown; outcomes?: Array<{ writes?: unknown; reason?: string; status?: string }> };
      expect(response.writes).toBe(writes);
      expect(response.outcomes?.[0]?.writes).toBe(writes);
      expect(response.outcomes?.[0]?.status).toBe("failed");
      if (status === 429) expect(response.outcomes?.[0]?.reason).toBe(GOOGLE_RATE_LIMITED);
      if (status === 500) expect(response.outcomes?.[0]?.reason).toBe("unconfirmed_write");
      if (status === 400) expect(response.outcomes?.[0]?.reason).toContain("400");
      expect(JSON.stringify(stored)).not.toContain(TOKEN);
      const again = await runApplyJob(job.id);
      expect(again.replayed).toBe(true);
      expect(mutates).toBe(1);
      const row = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(row?.connectionStatus).not.toBe("needs_reconnect");
      const audits = await getDb().select().from(clientAuditLog).where(eq(clientAuditLog.entityId, rec.id));
      expect(JSON.stringify(audits)).not.toContain(TOKEN);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });
});
