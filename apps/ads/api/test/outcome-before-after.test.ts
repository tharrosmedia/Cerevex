import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { settingsJsonWithCapabilityOverrides } from "@tharros/ads-shared";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { runApplyJob } from "@tharros/ads-shared/apply";
import { storeTokens } from "@tharros/ads-shared/credentials";
import { executeMutation } from "@tharros/ads-shared/mutate";
import {
  adAccounts,
  adEntities,
  applyJobs,
  authorizations,
  clientAuditLog,
  decisions,
  recommendations,
  workspaces,
} from "@tharros/ads-shared/schema";
import type { MutationOutcome, OutcomeValue } from "@tharros/ads-shared/mutate";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

const TOKEN = "EAARscrubtokenvalue1234567890extra";
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type PlatformName = "meta" | "google";
type ActionName = "pause" | "update_budget" | "update_bid";

let ownerId = "";
let clientId = "";
let workspaceId = "";
let seq = 0;

const envKeys = [
  "META_APP_ID",
  "META_APP_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
] as const;
const envBefore = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<
  (typeof envKeys)[number],
  string | undefined
>;

function nextDigits(): string {
  seq += 1;
  return `${Date.now()}${seq}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertUtc(value: OutcomeValue | undefined) {
  expect(value?.readAt).toMatch(UTC);
}

describe("R1 live before and after", () => {
  beforeAll(async () => {
    await ensureScopedUser();
    const owner = await login(
      process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
      process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
    );
    const me = await json(await app.request("/auth/me", { headers: { authorization: `Bearer ${owner.token}` } }));
    ownerId = String((me.user as { id: string }).id);
    const listed = (await json(await app.request("/clients", { headers: { authorization: `Bearer ${owner.token}` } })))
      .clients as { id: string; name: string; workspaceId: string }[];
    const got = listed.find((row) => row.name === "Got Ductless");
    if (!got) throw new Error("Seed client missing");
    clientId = got.id;
    workspaceId = got.workspaceId;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of envKeys) {
      const previous = envBefore[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  afterAll(async () => {
    await closeDb();
  });

  async function withApplyOpen(run: () => Promise<void>) {
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    const kill = workspace?.applyKillSwitch;
    const settingsSnapshot = (workspace?.settingsJson ?? {}) as Record<string, unknown>;
    await getDb()
      .update(workspaces)
      .set({
        applyKillSwitch: false,
        settingsJson: settingsJsonWithCapabilityOverrides(settingsSnapshot, {
          "apply.meta": "on",
          "sync.live": "on",
          "apply.budget": "on",
          "apply.bid": "on",
        }),
      })
      .where(eq(workspaces.id, workspaceId));
    try {
      await run();
    } finally {
      await getDb()
        .update(workspaces)
        .set({
          applyKillSwitch: kill ?? true,
          settingsJson: settingsSnapshot,
        })
        .where(eq(workspaces.id, workspaceId));
    }
  }

  async function seedAccount(input: {
    platform: PlatformName;
    mock?: boolean;
    entityStatus?: string;
    entityType?: string;
    rawJson?: Record<string, unknown>;
    accessToken?: string;
  }) {
    const digits = nextDigits();
    const externalId = input.platform === "meta" ? `act_${digits}` : `customers/${digits}`;
    const entityExternalId = nextDigits();
    const [account] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: input.platform,
        externalId,
        displayName: "R1 before after",
        connectionStatus: "connected",
      })
      .returning();
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: account.id,
      platform: input.platform,
      label: input.mock ? "mock" : "live",
      tokens: {
        accessToken: input.accessToken ?? (input.mock ? "mock-access-not-a-real-token" : TOKEN),
        mock: Boolean(input.mock),
      },
    });
    const [entity] = await getDb()
      .insert(adEntities)
      .values({
        workspaceId,
        clientId,
        adAccountId: account.id,
        platform: input.platform,
        entityType: input.entityType ?? "campaign",
        externalId: entityExternalId,
        name: "HVAC",
        status: input.entityStatus ?? "active",
        rawJson: input.rawJson ?? {},
      })
      .returning();
    return { account, entity, digits };
  }

  async function runJob(input: {
    accountId: string;
    platform: PlatformName;
    action: ActionName;
    entityType: string;
    externalId: string;
    name?: string;
    payload?: Record<string, unknown>;
  }) {
    const [rec] = await getDb()
      .insert(recommendations)
      .values({
        workspaceId,
        clientId,
        adAccountId: input.accountId,
        type: input.action === "pause" ? "pause_waste" : input.action,
        title: `R1 ${input.platform} ${input.action}`,
        rationale: "Record the live before and after.",
        risk: "low",
        evidenceJson: {},
        proposedMutationsJson: [
          {
            platform: input.platform,
            action: input.action,
            target: { entityType: input.entityType, externalId: input.externalId, name: input.name ?? "HVAC" },
            payload: input.payload ?? {},
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
        status: "queued",
        requestJson: {},
      })
      .returning();
    await runApplyJob(job.id);
    const stored = await getDb().query.applyJobs.findFirst({ where: eq(applyJobs.id, job.id) });
    const response = (stored?.responseJson ?? {}) as { outcomes?: MutationOutcome[] };
    const audits = await getDb().select().from(clientAuditLog).where(eq(clientAuditLog.entityId, rec.id));
    const auditOutcomes = audits.flatMap((row) => {
      const payload = row.payloadJson as { after?: { outcomes?: MutationOutcome[] } };
      return payload.after?.outcomes ?? [];
    });
    return { rec, job: stored, responseOutcomes: response.outcomes ?? [], auditOutcomes };
  }

  function configureLive(platform: PlatformName, customerId?: string) {
    if (platform === "meta") {
      process.env.META_APP_ID = "r1-test-app";
      process.env.META_APP_SECRET = "r1-test-secret";
      return;
    }
    process.env.GOOGLE_CLIENT_ID = "r1-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "r1-google-secret";
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "r1-developer-token";
    if (customerId) process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = customerId;
  }

  function stubMeta(input: {
    accountDigits: string;
    kind: "active" | "paused" | "bid" | "down" | "token-status";
    posts: string[];
  }) {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const href = String(url);
      expect(href).not.toContain(TOKEN);
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      const method = init.method ?? "GET";
      if (method === "POST") input.posts.push(href);
      if (input.kind === "down") return new Response("down", { status: 500 });
      if (new URL(href).searchParams.get("fields") === "currency") return jsonResponse({ currency: "USD" });
      if (method === "POST") return jsonResponse({ success: true });
      if (input.kind === "bid") {
        return jsonResponse({ id: "220", status: "ACTIVE", account_id: input.accountDigits, bid_amount: "250" });
      }
      return jsonResponse({
        id: "238",
        status: input.kind === "paused" ? "PAUSED" : input.kind === "token-status" ? `ACTIVE ${TOKEN}` : "ACTIVE",
        account_id: input.accountDigits,
        daily_budget: "5000",
      });
    });
  }

  function stubGoogle(input: { kind: "active" | "paused" | "bid" | "empty"; mutates: string[] }) {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const href = String(url);
      expect(href).not.toContain(TOKEN);
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      if (href.includes("googleAds:mutate")) input.mutates.push(href);
      if (href.includes("googleAds:search")) {
        if (input.kind === "empty") return jsonResponse({ results: [] });
        if (input.kind === "bid") {
          return jsonResponse({
            results: [{ adGroup: { status: "ENABLED", cpcBidMicros: "2500000" }, customer: { currencyCode: "USD" } }],
          });
        }
        return jsonResponse({
          results: [
            {
              campaign: { status: input.kind === "paused" ? "PAUSED" : "ENABLED" },
              campaignBudget: { amountMicros: "50000000" },
              customer: { currencyCode: "USD" },
            },
          ],
        });
      }
      return jsonResponse({ mutateOperationResponses: [{}] });
    });
  }

  function expectStored(responseOutcomes: MutationOutcome[], auditOutcomes: MutationOutcome[], outcome: MutationOutcome) {
    expect(responseOutcomes[0]).toEqual(outcome);
    expect(auditOutcomes).toContainEqual(outcome);
    const stored = JSON.stringify({ responseOutcomes, auditOutcomes });
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(TOKEN.toLowerCase());
  }

  it.each([
    ["meta", "pause", { unit: "status", before: { status: "active" }, after: { status: "paused" } }],
    ["meta", "update_budget", { unit: "minor", before: { amount: "5000" }, after: { amount: "4000" } }],
    ["meta", "update_bid", { unit: "minor", before: { amount: "250" }, after: { amount: "150" } }],
    ["google", "pause", { unit: "status", before: { status: "enabled" }, after: { status: "paused" } }],
    ["google", "update_budget", { unit: "micros", before: { amount: "50000000" }, after: { amount: "40000000" } }],
    ["google", "update_bid", { unit: "micros", before: { amount: "2500000" }, after: { amount: "1500000" } }],
  ] as const)("records live %s %s before and after in platform units", async (platform, action, expected) => {
    const entityType = action === "update_bid" ? (platform === "meta" ? "adset" : "ad_group") : "campaign";
    const payload = action === "pause" ? {} : { amount: action === "update_budget" ? 40 : 1.5 };
    const seeded = await seedAccount({ platform, entityType });
    const posts: string[] = [];
    const mutates: string[] = [];
    configureLive(platform, seeded.digits);
    if (platform === "meta") stubMeta({ accountDigits: seeded.digits, kind: action === "update_bid" ? "bid" : "active", posts });
    else stubGoogle({ kind: action === "update_bid" ? "bid" : "active", mutates });
    try {
      await withApplyOpen(async () => {
        const ran = await runJob({
          accountId: seeded.account.id,
          platform,
          action,
          entityType,
          externalId: seeded.entity.externalId,
          payload,
        });
        const outcome = ran.responseOutcomes[0];
        expect(outcome).toMatchObject({
          status: "applied",
          mode: "live",
          writes: true,
          revertible: true,
          before: { ...expected.before, unit: expected.unit, currency: "USD" },
          after: { ...expected.after, unit: expected.unit, currency: "USD" },
        });
        assertUtc(outcome?.before);
        assertUtc(outcome?.after);
        expectStored(ran.responseOutcomes, ran.auditOutcomes, outcome!);
        expect(JSON.stringify(ran.job?.responseJson)).not.toContain(TOKEN);
      });
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, seeded.account.id));
    }
  });

  it.each(["meta", "google"] as const)("already_applied %s pause records before = after = paused", async (platform) => {
    const seeded = await seedAccount({ platform });
    const posts: string[] = [];
    const mutates: string[] = [];
    configureLive(platform, seeded.digits);
    if (platform === "meta") stubMeta({ accountDigits: seeded.digits, kind: "paused", posts });
    else stubGoogle({ kind: "paused", mutates });
    try {
      await withApplyOpen(async () => {
        const ran = await runJob({
          accountId: seeded.account.id,
          platform,
          action: "pause",
          entityType: "campaign",
          externalId: seeded.entity.externalId,
        });
        const outcome = ran.responseOutcomes[0];
        expect(outcome?.status).toBe("already_applied");
        expect(outcome?.before).toEqual(outcome?.after);
        expect(outcome?.before).toMatchObject({ status: "paused", unit: "status", currency: "USD" });
        assertUtc(outcome?.before);
        expectStored(ran.responseOutcomes, ran.auditOutcomes, outcome!);
        expect(posts).toEqual([]);
        expect(mutates).toEqual([]);
      });
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, seeded.account.id));
    }
  });

  it("live read null is not revertible", async () => {
    const meta = await seedAccount({ platform: "meta" });
    const google = await seedAccount({ platform: "google" });
    try {
      await withApplyOpen(async () => {
        configureLive("meta");
        stubMeta({ accountDigits: meta.digits, kind: "down", posts: [] });
        const metaRan = await runJob({
          accountId: meta.account.id,
          platform: "meta",
          action: "pause",
          entityType: "campaign",
          externalId: meta.entity.externalId,
        });
        expect(metaRan.responseOutcomes[0]).toMatchObject({
          status: "failed",
          writes: false,
          revertible: false,
          revertBlock: "no_before_value",
        });
        expect(metaRan.responseOutcomes[0]?.before).toBeUndefined();
        expectStored(metaRan.responseOutcomes, metaRan.auditOutcomes, metaRan.responseOutcomes[0]!);

        configureLive("google", google.digits);
        stubGoogle({ kind: "empty", mutates: [] });
        const googleRan = await runJob({
          accountId: google.account.id,
          platform: "google",
          action: "pause",
          entityType: "campaign",
          externalId: google.entity.externalId,
        });
        expect(googleRan.responseOutcomes[0]).toMatchObject({
          revertible: false,
          revertBlock: "no_before_value",
        });
        expect(googleRan.responseOutcomes[0]?.before).toBeUndefined();
        expectStored(googleRan.responseOutcomes, googleRan.auditOutcomes, googleRan.responseOutcomes[0]!);
      });
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, meta.account.id));
      await getDb().delete(adAccounts).where(eq(adAccounts.id, google.account.id));
    }
  });

  it("mock outcomes record mock values and mode mock", async () => {
    const seeded = await seedAccount({
      platform: "meta",
      mock: true,
      rawJson: { dailyBudget: 25, bidAmount: 1.25 },
    });
    const paused = await seedAccount({ platform: "meta", mock: true, entityStatus: "paused" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("mock apply must not call the platform");
    });
    try {
      await withApplyOpen(async () => {
        const pause = await runJob({
          accountId: seeded.account.id,
          platform: "meta",
          action: "pause",
          entityType: "campaign",
          externalId: seeded.entity.externalId,
        });
        expect(pause.responseOutcomes[0]).toMatchObject({
          mode: "mock",
          status: "applied",
          before: { status: "active", unit: "mock" },
          after: { status: "paused", unit: "mock" },
        });
        expectStored(pause.responseOutcomes, pause.auditOutcomes, pause.responseOutcomes[0]!);

        const budget = await executeMutation({
          adAccountId: seeded.account.id,
          platform: "meta",
          accountExternalId: seeded.account.externalId,
          mutation: {
            platform: "meta",
            action: "update_budget",
            target: { entityType: "campaign", externalId: seeded.entity.externalId, name: "HVAC" },
            payload: { amount: 40 },
          },
        });
        expect(budget).toMatchObject({
          mode: "mock",
          before: { amount: "25", unit: "mock" },
          after: { amount: "40", unit: "mock" },
        });

        const bid = await executeMutation({
          adAccountId: seeded.account.id,
          platform: "meta",
          accountExternalId: seeded.account.externalId,
          mutation: {
            platform: "meta",
            action: "update_bid",
            target: { entityType: "adset", externalId: seeded.entity.externalId, name: "HVAC" },
            payload: { amount: 2 },
          },
        });
        expect(bid).toMatchObject({
          mode: "mock",
          before: { amount: "1.25", unit: "mock" },
          after: { amount: "2", unit: "mock" },
        });

        const already = await executeMutation({
          adAccountId: paused.account.id,
          platform: "meta",
          accountExternalId: paused.account.externalId,
          mutation: {
            platform: "meta",
            action: "pause",
            target: { entityType: "campaign", externalId: paused.entity.externalId, name: "HVAC" },
            payload: {},
          },
        });
        expect(already.mode).toBe("mock");
        expect(already.before).toEqual(already.after);
        expect(already.before).toMatchObject({ status: "paused", unit: "mock" });
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await getDb().delete(adAccounts).where(eq(adAccounts.id, seeded.account.id));
      await getDb().delete(adAccounts).where(eq(adAccounts.id, paused.account.id));
    }
  });

  it("scrubs the access token out of stored before and after values", async () => {
    const seeded = await seedAccount({ platform: "meta" });
    configureLive("meta");
    stubMeta({ accountDigits: seeded.digits, kind: "token-status", posts: [] });
    try {
      await withApplyOpen(async () => {
        const ran = await runJob({
          accountId: seeded.account.id,
          platform: "meta",
          action: "pause",
          entityType: "campaign",
          externalId: seeded.entity.externalId,
          name: `Campaign ${TOKEN}`,
        });
        const audits = await getDb().select().from(clientAuditLog).where(eq(clientAuditLog.entityId, ran.rec.id));
        const blob = JSON.stringify({
          response: ran.job?.responseJson,
          audits,
        });
        expect(blob).not.toContain(TOKEN);
        expect(blob).not.toContain(TOKEN.toLowerCase());
        expect(ran.responseOutcomes[0]?.before?.status).toContain("[redacted]");
        expect(ran.responseOutcomes[0]?.before?.status).not.toContain(TOKEN.toLowerCase());
        expect(ran.responseOutcomes[0]?.target.name).toBe(`Campaign [redacted]`);
        expect(ran.auditOutcomes.some((row) => JSON.stringify(row).includes(TOKEN))).toBe(false);
      });
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, seeded.account.id));
    }
  });
});
