import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { readConnectorSettings, settingsJsonWithConnectors } from "@tharros/ads-shared/connector-settings";
import { storeTokens } from "@tharros/ads-shared/credentials";
import { closeDb, getDb, getPool } from "@tharros/ads-shared/db";
import {
  adAccounts,
  auditLog,
  clientMemberships,
  clients,
  locations,
  memberships,
  skillClientConfigs,
  skillStoreConfigs,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { SETUP_ACCOUNT_STATUSES } from "../src/client-setup";
import { app, ensureScopedUser, json, login } from "./helpers";

const INTERNAL_KEY = "cs4-client-setup-internal-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;
const ORIGINAL_WORKSPACE = process.env.ADS_INTERNAL_WORKSPACE_ID;
const marker = `cs4-${Date.now().toString(36)}`;
const CALLRAIL_KEY = `cs4-callrail-key-${marker}`;
const META_TOKEN = `cs4-meta-token-${marker}`;
const SKILL_SECRET = `cs4-skill-secret-${marker}`;
const FACT_SECRET = `cs4-missing-fact-${marker}`;

describe("GET /clients/:id/setup", () => {
  let ownerToken = "";
  let readonlyToken = "";
  let outsiderToken = "";
  let workspaceId = "";
  let ownerId = "";
  let clientId = "";
  let bareId = "";
  let loadedId = "";
  let metaAccountId = "";
  let otherClientId = "";
  let originalSettings: unknown = {};
  const slug = "hvac-usa";
  const loadedSlug = "elmar-hvac";
  const siteId = `cs4-site-${marker}`;
  let savedProfiles: Array<typeof skillClientConfigs.$inferSelect> = [];
  let savedStores: Array<typeof skillStoreConfigs.$inferSelect> = [];

  const owner = () => ({ authorization: `Bearer ${ownerToken}` });

  function itemStatus(body: Record<string, unknown>, id: string): string | undefined {
    const checklist = body.checklist as Array<{ id: string; status: string }>;
    return checklist.find((item) => item.id === id)?.status;
  }

  async function readSetup(id: string, headers: Record<string, string> = owner()) {
    return app.request(`/clients/${id}/setup`, { headers });
  }

  beforeAll(async () => {
    await ensureScopedUser();
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    outsiderToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    originalSettings = workspace.settingsJson;
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    const ownerUser = await db.query.users.findFirst({
      where: eq(users.email, (process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com").toLowerCase()),
    });
    if (!ownerUser) throw new Error("Seed owner missing");
    ownerId = ownerUser.id;

    const email = `cs4.readonly.${marker}@tharrosmedia.com`;
    const passwordHash = await hash("cs4-readonly", 10);
    const [reader] = await db
      .insert(users)
      .values({ email, name: "CS4 reader", passwordHash })
      .returning();
    if (!reader) throw new Error("reader missing");
    await db.insert(memberships).values({ userId: reader.id, workspaceId, role: "client_readonly" });
    readonlyToken = (await login(email, "cs4-readonly")).token;

    const [client] = await db
      .insert(clients)
      .values({ workspaceId, name: `HVAC USA ${marker}`, status: "active", plan: "paid", siteId })
      .returning();
    const [bare] = await db
      .insert(clients)
      .values({ workspaceId, name: `Bare ${marker}`, status: "active", plan: "paid", siteId: null })
      .returning();
    const [loaded] = await db
      .insert(clients)
      .values({ workspaceId, name: `Loaded ${marker}`, status: "active", plan: "paid", siteId: null })
      .returning();
    if (!client || !bare || !loaded) throw new Error("clients missing");
    clientId = client.id;
    bareId = bare.id;
    loadedId = loaded.id;
    await db.insert(clientMemberships).values({ userId: reader.id, clientId, role: "client_readonly" });

    const [meta] = await db
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "meta",
        externalId: `act_${marker}`,
        displayName: "Meta HVAC",
        connectionStatus: "connected",
        lastError: null,
      })
      .returning();
    if (!meta) throw new Error("meta account missing");
    metaAccountId = meta.id;
    await storeTokens({
      workspaceId,
      clientId,
      adAccountId: meta.id,
      platform: "meta",
      label: "live",
      tokens: { accessToken: META_TOKEN, mock: false },
    });

    await db.insert(locations).values([
      { workspaceId, clientId, storeId: siteId, status: "active" },
      { workspaceId, clientId, storeId: `closed-${marker}`, status: "inactive" },
    ]);

    const connectors = readConnectorSettings(originalSettings);
    await db
      .update(workspaces)
      .set({
        settingsJson: settingsJsonWithConnectors(originalSettings as Record<string, unknown>, {
          ...connectors,
          callrail: {
            ...connectors.callrail,
            [clientId]: {
              connected: true,
              mock: false,
              accountId: `acct-${marker}`,
              encryptedApiKey: CALLRAIL_KEY,
            },
          },
        }),
      })
      .where(eq(workspaces.id, workspaceId));

    savedProfiles = await db
      .select()
      .from(skillClientConfigs)
      .where(inArray(skillClientConfigs.slug, [slug, loadedSlug]));
    savedStores = await db
      .select()
      .from(skillStoreConfigs)
      .where(inArray(skillStoreConfigs.clientSlug, [slug, loadedSlug]));
    if (savedProfiles.length) {
      await db.delete(skillClientConfigs).where(inArray(skillClientConfigs.slug, [slug, loadedSlug]));
    }

    const facts = Array.from({ length: 14 }, (_, index) =>
      index === 0 ? { field: FACT_SECRET } : { field: `fact-${index}` },
    );
    await db.insert(skillClientConfigs).values({
      slug,
      clientId,
      displayName: "HVAC USA",
      snapshotId: `snap-${marker}`,
      profileHash: `hash-${marker}`,
      marketingGate: "off",
      scopeAllowed: true,
      pilot: true,
      approvalOwnerResolved: "agency owner",
      approvalOwnerUserId: ownerId,
      configJson: { note: SKILL_SECRET },
      missingFactsJson: facts,
    });
    await db.insert(skillStoreConfigs).values({
      clientSlug: slug,
      storeKey: "web",
      brainStoreId: siteId,
      role: "web",
      configJson: { note: SKILL_SECRET },
    });
    await db.insert(skillClientConfigs).values({
      slug: loadedSlug,
      clientId: loadedId,
      displayName: "Loaded only",
      snapshotId: `snap-loaded-${marker}`,
      profileHash: `hash-loaded-${marker}`,
      marketingGate: "off",
      scopeAllowed: true,
      pilot: false,
      approvalOwnerResolved: "agency owner",
      approvalOwnerUserId: ownerId,
      configJson: { note: "loaded" },
      missingFactsJson: [{ field: "one" }, { field: "two" }],
    });
    await db.insert(skillStoreConfigs).values({
      clientSlug: loadedSlug,
      storeKey: "web",
      brainStoreId: null,
      role: "web",
      configJson: {},
    });

    const [otherWs] = await db.insert(workspaces).values({ name: `CS4 other ${marker}` }).returning();
    if (!otherWs) throw new Error("other workspace missing");
    const [other] = await db
      .insert(clients)
      .values({ workspaceId: otherWs.id, name: `Other ${marker}`, status: "active" })
      .returning();
    if (!other) throw new Error("other client missing");
    otherClientId = other.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(skillClientConfigs).where(inArray(skillClientConfigs.slug, [slug, loadedSlug]));
    if (savedProfiles.length) {
      await db.insert(skillClientConfigs).values(savedProfiles);
      if (savedStores.length) await db.insert(skillStoreConfigs).values(savedStores);
    }
    const ids = [clientId, bareId, loadedId].filter(Boolean);
    if (ids.length) await db.delete(clients).where(inArray(clients.id, ids));
    if (otherClientId) await db.delete(clients).where(eq(clients.id, otherClientId));
    await db.update(workspaces).set({ settingsJson: originalSettings }).where(eq(workspaces.id, workspaceId));
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
    if (ORIGINAL_WORKSPACE === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = ORIGINAL_WORKSPACE;
    await closeDb();
  });

  async function setMeta(status: string, lastError: string | null) {
    await getDb()
      .update(adAccounts)
      .set({ connectionStatus: status, lastError })
      .where(eq(adAccounts.id, metaAccountId));
  }

  it("returns the ads checklist for a connected Meta client with Google missing", async () => {
    const beforeAudits = await getDb().select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.workspaceId, workspaceId));
    const beforeClient = await getDb().query.clients.findFirst({ where: eq(clients.id, clientId) });
    const { result, writes } = await withWriteSpy(() => readSetup(clientId));
    expect(result.status).toBe(200);
    const body = await json(result);
    expect(writes).toEqual([]);
    expect(body.clientId).toBe(clientId);
    expect(body.name).toBe(`HVAC USA ${marker}`);
    expect(body.plan).toBe("paid");
    expect(itemStatus(body, "site")).toBe("linked");
    expect(body.site).toEqual({ status: "linked", siteId });
    expect(itemStatus(body, "meta")).toBe("connected");
    expect(itemStatus(body, "google")).toBe("disconnected");
    expect(itemStatus(body, "callrail")).toBe("present");
    expect(body.callrail).toEqual({ present: true });
    expect(itemStatus(body, "skills")).toBe("linked");
    expect(body.skills).toEqual({ slug, loaded: true, linked: true, missingFacts: 14 });
    const accounts = body.accounts as { meta: Array<{ status: string; externalId: string }>; google: unknown[] };
    expect(accounts.google).toEqual([]);
    expect(accounts.meta).toEqual([
      { id: metaAccountId, externalId: `act_${marker}`, displayName: "Meta HVAC", status: "connected" },
    ]);
    expect(body.locations).toEqual([{ id: expect.any(String), storeId: siteId }]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(CALLRAIL_KEY);
    expect(text).not.toContain(META_TOKEN);
    expect(text).not.toContain(SKILL_SECRET);
    expect(text).not.toContain(FACT_SECRET);
    expect(text).not.toContain("encryptedApiKey");
    expect(text).not.toContain("accessToken");
    expect(text).not.toContain("encryptedPayload");
    const afterAudits = await getDb().select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.workspaceId, workspaceId));
    expect(afterAudits).toHaveLength(beforeAudits.length);
    const afterClient = await getDb().query.clients.findFirst({ where: eq(clients.id, clientId) });
    expect(afterClient).toEqual(beforeClient);
  });

  it.each(SETUP_ACCOUNT_STATUSES)("reports Meta status %s", async (status) => {
    await setMeta(status, null);
    const res = await readSetup(clientId);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(itemStatus(body, "meta")).toBe(status);
    const accounts = body.accounts as { meta: Array<{ status: string }> };
    expect(accounts.meta.map((row) => row.status)).toEqual([status]);
  });

  it("maps a token error to needs_reconnect and leaves a plain error as error", async () => {
    await setMeta("error", "meta.token_expired");
    const expired = await json(await readSetup(clientId));
    expect(itemStatus(expired, "meta")).toBe("needs_reconnect");

    await setMeta("error", "budget update failed");
    const plain = await json(await readSetup(clientId));
    expect(itemStatus(plain, "meta")).toBe("error");
  });

  it("keeps the platform connected when another account needs reconnect", async () => {
    await setMeta("connected", null);
    const [extra] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "meta",
        externalId: `act_extra_${marker}`,
        displayName: "Meta extra",
        connectionStatus: "needs_reconnect",
      })
      .returning();
    if (!extra) throw new Error("extra account missing");
    try {
      const body = await json(await readSetup(clientId));
      expect(itemStatus(body, "meta")).toBe("connected");
      const accounts = body.accounts as { meta: Array<{ status: string }> };
      expect(accounts.meta.map((row) => row.status).sort()).toEqual(["connected", "needs_reconnect"]);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, extra.id));
    }
  });

  it("reports Google connected when an account is connected", async () => {
    const [google] = await getDb()
      .insert(adAccounts)
      .values({
        workspaceId,
        clientId,
        platform: "google",
        externalId: `g_${marker}`,
        displayName: "Google HVAC",
        connectionStatus: "connected",
      })
      .returning();
    if (!google) throw new Error("google account missing");
    try {
      const body = await json(await readSetup(clientId));
      expect(itemStatus(body, "google")).toBe("connected");
      const accounts = body.accounts as { google: Array<{ id: string; status: string }> };
      expect(accounts.google).toEqual([
        { id: google.id, externalId: `g_${marker}`, displayName: "Google HVAC", status: "connected" },
      ]);
    } finally {
      await getDb().delete(adAccounts).where(eq(adAccounts.id, google.id));
    }
  });

  it("reports a client with nothing set as missing", async () => {
    const res = await readSetup(bareId);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(itemStatus(body, "site")).toBe("missing");
    expect(body.site).toEqual({ status: "missing", siteId: null });
    expect(itemStatus(body, "meta")).toBe("disconnected");
    expect(itemStatus(body, "google")).toBe("disconnected");
    expect(itemStatus(body, "callrail")).toBe("missing");
    expect(body.callrail).toEqual({ present: false });
    expect(itemStatus(body, "skills")).toBe("missing");
    expect(body.skills).toEqual({ slug: null, loaded: false, linked: false, missingFacts: 0 });
    expect(body.locations).toEqual([]);
    expect(body.accounts).toEqual({ meta: [], google: [] });
  });

  it("reports a skills profile as loaded until the site is linked", async () => {
    const body = await json(await readSetup(loadedId));
    expect(itemStatus(body, "site")).toBe("missing");
    expect(itemStatus(body, "skills")).toBe("loaded");
    expect(body.skills).toEqual({ slug: loadedSlug, loaded: true, linked: false, missingFacts: 2 });
  });

  it("lets a member of the client read the setup", async () => {
    const res = await readSetup(clientId, { authorization: `Bearer ${readonlyToken}` });
    expect(res.status).toBe(200);
    expect((await json(res)).clientId).toBe(clientId);

    const service = await readSetup(clientId, { "x-cerevex-internal-key": INTERNAL_KEY });
    expect(service.status).toBe(200);
  });

  it("returns 404 for another workspace, another client, and a non-UUID id", async () => {
    const cross = await readSetup(otherClientId);
    expect(cross.status).toBe(404);
    expect((await json(cross)).error).toBe("Client not found");

    const otherClient = await readSetup(clientId, { authorization: `Bearer ${outsiderToken}` });
    expect(otherClient.status).toBe(404);
    expect((await json(otherClient)).error).toBe("Client not found");

    const missing = await readSetup("00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);

    for (const id of ["not-a-uuid", "123", "setup"]) {
      const res = await readSetup(id);
      expect(res.status).toBe(404);
      expect((await json(res)).error).toBe("Client not found");
    }
  });
});

function sqlText(query: unknown): string {
  if (typeof query === "string") return query;
  if (query && typeof query === "object" && "text" in query) return String((query as { text: unknown }).text);
  return "";
}

function noteWrite(writes: string[], query: unknown) {
  const text = sqlText(query);
  if (/^\s*(insert|update|delete|alter|create|drop)\b/i.test(text)) writes.push(text);
}

async function withWriteSpy<T>(run: () => Promise<T>): Promise<{ result: T; writes: string[] }> {
  const pool = getPool();
  const writes: string[] = [];
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  pool.query = ((...args: Parameters<Pool["query"]>) => {
    noteWrite(writes, args[0]);
    return originalQuery(...args);
  }) as Pool["query"];
  pool.connect = ((...args: Parameters<Pool["connect"]>) => {
    if (typeof args[0] === "function") return originalConnect(...args);
    return originalConnect().then((client) => watchClient(client, writes));
  }) as Pool["connect"];
  try {
    const result = await run();
    return { result, writes };
  } finally {
    pool.query = originalQuery as Pool["query"];
    pool.connect = originalConnect as Pool["connect"];
  }
}

function watchClient(client: PoolClient, writes: string[]): PoolClient {
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);
  client.query = ((...args: Parameters<PoolClient["query"]>) => {
    noteWrite(writes, args[0]);
    return originalQuery(...args);
  }) as PoolClient["query"];
  client.release = (err) => {
    client.query = originalQuery;
    originalRelease(err);
  };
  return client;
}
