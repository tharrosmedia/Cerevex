import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { defaultCapabilityFlags, settingsJsonWithCapabilityOverrides } from "@tharros/ads-shared";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { requeueFailedApplyJob, runApplyJob } from "@tharros/ads-shared/apply";
import { metaAdPlatformConnector } from "@tharros/ads-shared/connectors";
import { storeTokens } from "@tharros/ads-shared/credentials";
import { executeMutation } from "@tharros/ads-shared/mutate";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import {
  adAccounts,
  adEntities,
  applyJobs,
  clients,
  authorizations,
  decisions,
  recommendations,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { REAL_TOKEN_MOCK_REFUSED } from "@tharros/ads-shared/live-or-loud";
import { warnIfMetaNotConfigured, workerHealthBody } from "@tharros/ads-shared/worker-health";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const REAL_TOKEN = "m1-real-token-not-sent";
const NOT_CONFIGURED = "meta.not_configured";
const NOT_CONFIGURED_APPLY = "Meta isn't set up on this server. Nothing was written.";

describe("Meta live-or-loud", () => {
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
    clearMetaEnv();
  });

  afterAll(async () => {
    restoreMetaEnv();
    await closeDb();
  });

  function clearMetaEnv() {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
  }

  function configureMetaEnv() {
    process.env.META_APP_ID = "m1-test-app";
    process.env.META_APP_SECRET = "m1-test-secret";
  }

  function restoreMetaEnv() {
    if (metaAppId === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = metaAppId;
    if (metaAppSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = metaAppSecret;
  }

  async function seedAccount(input: { mock: boolean; externalId: string; entityStatus?: string; clientId?: string }) {
    const accountClientId = input.clientId ?? clientId;
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId: accountClientId,
        platform: "meta",
        externalId: input.externalId,
        displayName: "M1 live-or-loud",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId: accountClientId,
      adAccountId: account.id,
      platform: "meta",
      label: input.mock ? "mock" : "live",
      tokens: {
        accessToken: input.mock ? "mock-access-not-a-real-token" : REAL_TOKEN,
        mock: input.mock,
      },
    });
    const [entity] = await getDb()
      .insert(adEntities)
      .values({
        workspaceId,
        clientId: accountClientId,
        adAccountId: account.id,
        platform: "meta",
        entityType: "campaign",
        externalId: `kept-${account.id}`,
        name: "Kept campaign",
        status: input.entityStatus ?? "active",
        rawJson: { source: "live" },
      })
      .returning();
    return { account, entity };
  }

  async function entitySnapshot(adAccountId: string) {
    const rows = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, adAccountId));
    return rows.map((row) => ({
      id: row.id,
      externalId: row.externalId,
      status: row.status,
      raw: row.rawJson,
    }));
  }

  function guardFetch() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("platform call");
    });
  }

  it("refuses a mock pull for a real Meta token and still mocks a mock token", async () => {
    const target = {
      platform: "meta" as const,
      externalId: "act_1",
      clientName: "Pilot",
    };
    await expect(
      metaAdPlatformConnector.pull({
        ...target,
        tokens: { accessToken: REAL_TOKEN, mock: false },
        allowLive: false,
      }),
    ).rejects.toThrow(REAL_TOKEN_MOCK_REFUSED);
    const pulled = await metaAdPlatformConnector.pull({
      ...target,
      tokens: { accessToken: "mock-access-not-a-real-token", mock: true },
      allowLive: false,
    });
    expect(pulled.mode).toBe("mock");
    expect(pulled.entities.length).toBeGreaterThan(0);
  });

  it("reports Meta config on worker health and warns once at startup when it is missing", () => {
    clearMetaEnv();
    process.env.META_APP_SECRET = "sentinel-should-not-log";
    try {
      const missing = workerHealthBody({ dbOk: true, inngestStatus: "ok", functionIds: ["ads-sync"] });
      expect(missing.oauth.meta.configured).toBe(false);
      expect(missing.oauth.meta).not.toHaveProperty("appId");
      const lines: string[] = [];
      expect(warnIfMetaNotConfigured((message) => lines.push(message))).toBe(true);
      expect(lines).toEqual(["Meta isn't set up on this worker. A real Meta token will not get test data."]);
      expect(lines[0]).not.toContain("sentinel-should-not-log");
      expect(lines[0]).not.toContain(REAL_TOKEN);

      configureMetaEnv();
      const ready = workerHealthBody({ dbOk: true, inngestStatus: "down", functionIds: ["ads-sync"] });
      expect(ready.oauth.meta.configured).toBe(true);
      expect(warnIfMetaNotConfigured((message) => lines.push(message))).toBe(false);
      expect(lines).toHaveLength(1);
    } finally {
      clearMetaEnv();
    }
  });

  it("does not replace a real Meta account with mock rows when this process is not configured", async () => {
    clearMetaEnv();
    const { account, entity } = await seedAccount({ mock: false, externalId: `act_m1_unconfigured_${Date.now()}` });
    const before = await entitySnapshot(account.id);
    const fetchMock = guardFetch();
    try {
      const result = await runAdAccountSync(account.id);
      expect(result.status).toBe("error");
      expect(result.lastError).toBe(NOT_CONFIGURED);
      expect(result.entityCount).toBe(0);
      expect(result.mode).not.toBe("mock");
      const stored = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(stored?.connectionStatus).toBe("error");
      expect(stored?.lastError).toBe(NOT_CONFIGURED);
      expect(stored?.externalId).toBe(account.externalId);
      expect(await entitySnapshot(account.id)).toEqual(before);
      expect(before[0]?.id).toBe(entity.id);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("skips a real Meta account when sync.live is off and leaves rows in place", async () => {
    configureMetaEnv();
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    const previous = (workspace?.settingsJson ?? {}) as Record<string, unknown>;
    const { account } = await seedAccount({ mock: false, externalId: `act_m1_sync_off_${Date.now()}` });
    const before = await entitySnapshot(account.id);
    const fetchMock = guardFetch();
    try {
      await getDb()
        .update(workspaces)
        .set({ settingsJson: settingsJsonWithCapabilityOverrides(previous, { "sync.live": "hidden" }) })
        .where(eq(workspaces.id, workspaceId));
      const result = await runAdAccountSync(account.id);
      expect(result.status).toBe("skipped");
      expect(result.lastError).toMatch(/sync\.live is off/);
      expect(result.entityCount).toBe(0);
      expect(result.lastError).not.toContain(REAL_TOKEN);
      const stored = await getDb().query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) });
      expect(stored?.connectionStatus).toBe("connected");
      expect(stored?.connectionStatus).not.toBe("syncing");
      expect(await entitySnapshot(account.id)).toEqual(before);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      clearMetaEnv();
      await getDb().update(workspaces).set({ settingsJson: previous }).where(eq(workspaces.id, workspaceId));
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("still writes mock rows for a mock Meta token", async () => {
    clearMetaEnv();
    const [mockClient] = await getDb()
      .insert(clients)
      .values({ workspaceId, name: `M1 Mock ${Date.now()}` })
      .returning();
    const { account } = await seedAccount({
      mock: true,
      externalId: `act_m1_mock_${Date.now()}`,
      clientId: mockClient.id,
    });
    const fetchMock = guardFetch();
    try {
      const result = await runAdAccountSync(account.id);
      expect(result.status).toBe("connected");
      expect(result.mode).toBe("mock");
      expect(result.entityCount).toBeGreaterThan(0);
      expect(result.lastError).toBeNull();
      const rows = await getDb().select().from(adEntities).where(eq(adEntities.adAccountId, account.id));
      expect(rows.some((row) => row.externalId.startsWith("meta-"))).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await getDb().delete(clients).where(eq(clients.id, mockClient.id));
    }
  });

  it("fails a real-token apply when Meta is not configured and does not settle the job succeeded", async () => {
    clearMetaEnv();
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    const kill = workspace?.applyKillSwitch;
    const { account, entity } = await seedAccount({ mock: false, externalId: `act_m1_apply_${Date.now()}` });
    const fetchMock = guardFetch();
    try {
      await getDb().update(workspaces).set({ applyKillSwitch: false }).where(eq(workspaces.id, workspaceId));
      const [rec] = await getDb()
        .insert(recommendations)
        .values({
          workspaceId,
          clientId,
          adAccountId: account.id,
          type: "pause_waste",
          title: "Pause must not mock-succeed",
          rationale: "A real token in a process without Meta app credentials.",
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
      expect(ran.applyJob.status).not.toBe("succeeded");
      expect(ran.applyJob.status).toBe("failed");
      expect(ran.writes).toBe(false);
      expect(ran.applyJob.error).toBe(NOT_CONFIGURED_APPLY);
      const response = ran.applyJob.response as { writes?: unknown; outcomes?: { reason?: string; writes?: unknown; status?: string }[] } | null;
      expect(response?.writes).toBe(false);
      expect(response?.outcomes?.[0]?.status).toBe("failed");
      expect(response?.outcomes?.[0]?.writes).toBe(false);
      expect(response?.outcomes?.[0]?.reason).toBe(NOT_CONFIGURED_APPLY);
      expect(JSON.stringify(response)).not.toContain("Mock apply");
      expect(JSON.stringify(response)).not.toContain(REAL_TOKEN);
      const storedEntity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entity.id) });
      expect(storedEntity?.status).toBe("active");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await getDb()
        .update(workspaces)
        .set({ applyKillSwitch: kill ?? true })
        .where(eq(workspaces.id, workspaceId));
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("does not mock-apply a real token when sync.live is off", async () => {
    configureMetaEnv();
    const { account, entity } = await seedAccount({ mock: false, externalId: `act_m1_apply_off_${Date.now()}` });
    const fetchMock = guardFetch();
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
        capabilities: { ...defaultCapabilityFlags(), "sync.live": "hidden" },
      });
      expect(outcome.status).toBe("skipped");
      expect(outcome.writes).toBe(false);
      expect(outcome.mode).not.toBe("mock");
      expect(outcome.reason).toMatch(/sync\.live is off/);
      expect(outcome.reason).not.toContain(REAL_TOKEN);
      const storedEntity = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entity.id) });
      expect(storedEntity?.status).toBe("active");
      expect((storedEntity?.rawJson as { source?: string }).source).toBe("live");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      clearMetaEnv();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });

  it("does not treat a local paused row as proof a real-token pause landed", async () => {
    clearMetaEnv();
    const { account, entity } = await seedAccount({
      mock: false,
      externalId: `act_m1_requeue_${Date.now()}`,
      entityStatus: "paused",
    });
    try {
      const [rec] = await getDb()
        .insert(recommendations)
        .values({
          workspaceId,
          clientId,
          adAccountId: account.id,
          scope: "ad_account",
          type: "pause_waste",
          title: "Do not trust the local row",
          rationale: "A paused local row must not count as a Meta write.",
          risk: "low",
          evidenceJson: {},
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
      const [decision] = await getDb()
        .insert(decisions)
        .values({
          workspaceId,
          clientId,
          recommendationId: rec.id,
          userId: ownerId,
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
          status: "failed",
          error: "earlier",
          responseJson: { writes: true, claimedAt: "2000-01-01T00:00:00.000Z", outcomes: [] },
        })
        .returning();
      const refused = await requeueFailedApplyJob(job.id, { reconciled: true });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toBe("unreconciled_write");
      const stored = await getDb().query.adEntities.findFirst({ where: eq(adEntities.id, entity.id) });
      expect(stored?.status).toBe("paused");
      expect(stored?.externalId).toBe(entity.externalId);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, account.id));
    }
  });
});
