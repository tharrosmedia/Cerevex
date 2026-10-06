import { hash } from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importProfiles } from "@cerevex/skills";
import { and, desc, eq } from "drizzle-orm";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { auditLog, clients, memberships, skillClientConfigs, skillStoreConfigs, users, workspaces } from "@tharros/ads-shared/schema";
import { linkedStoreBrainId } from "@tharros/ads-shared/skill-profile-link";
import type { StoreSkillConfig } from "@cerevex/skills";
import { app, json, login } from "./helpers";

const INTERNAL_KEY = "skills-profile-test-internal-key";
const ORIGINAL_KEY = process.env.ADS_INTERNAL_KEY;
const ORIGINAL_WORKSPACE = process.env.ADS_INTERNAL_WORKSPACE_ID;

function store(role: StoreSkillConfig["role"], brainStoreId: string | null = null): StoreSkillConfig {
  return { role, brainStoreId } as StoreSkillConfig;
}

describe("skills profile load", () => {
  it("points web and service-area store keys at the client site", () => {
    expect(linkedStoreBrainId("site-1", store("web"))).toBe("site-1");
    expect(linkedStoreBrainId("site-1", store("service-area"))).toBe("site-1");
    expect(linkedStoreBrainId("site-1", store("storefront"))).toBeNull();
    expect(linkedStoreBrainId("site-1", store("product", "kept"))).toBe("kept");
  });
});

describe("POST /clients/:id/skills-profile", () => {
  let ownerToken = "";
  let operatorToken = "";
  let workspaceId = "";
  let ownerId = "";
  let withSiteId = "";
  let otherSiteId = "";
  let noSiteId = "";
  const siteId = `cs8-site-${Date.now().toString(36)}`;
  const otherSite = `cs8-other-${Date.now().toString(36)}`;
  const hvacName = `CS8 HVAC ${Date.now().toString(36)}`;
  const otherName = `CS8 Other ${Date.now().toString(36)}`;
  const bareName = `CS8 Bare ${Date.now().toString(36)}`;

  beforeAll(async () => {
    process.env.ADS_INTERNAL_KEY = INTERNAL_KEY;
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing");
    workspaceId = workspace.id;
    process.env.ADS_INTERNAL_WORKSPACE_ID = workspaceId;
    const owner = await db.query.users.findFirst({
      where: eq(users.email, process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com"),
    });
    if (!owner) throw new Error("Seed owner missing");
    ownerId = owner.id;

    const email = "skills.profile.operator@tharrosmedia.com";
    const passwordHash = await hash("skills-profile-operator", 10);
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    const operator =
      existing ??
      (await db.insert(users).values({ email, name: "Skills profile operator", passwordHash }).returning())[0];
    if (!operator) throw new Error("operator missing");
    if (existing) await db.update(users).set({ passwordHash }).where(eq(users.id, operator.id));
    await db.insert(memberships).values({ userId: operator.id, workspaceId, role: "operator" }).onConflictDoNothing();
    operatorToken = (await login(email, "skills-profile-operator")).token;

    await db.delete(skillClientConfigs).where(eq(skillClientConfigs.slug, "hvac-usa"));
    const [withSite] = await db
      .insert(clients)
      .values({ workspaceId, name: hvacName, pilotFlag: false, status: "active", siteId })
      .returning();
    const [other] = await db
      .insert(clients)
      .values({ workspaceId, name: otherName, pilotFlag: false, status: "active", siteId: otherSite })
      .returning();
    const [bare] = await db
      .insert(clients)
      .values({ workspaceId, name: bareName, pilotFlag: false, status: "active", siteId: null })
      .returning();
    if (!withSite || !other || !bare) throw new Error("test clients missing");
    withSiteId = withSite.id;
    otherSiteId = other.id;
    noSiteId = bare.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(skillClientConfigs).where(eq(skillClientConfigs.slug, "hvac-usa"));
    await db.delete(clients).where(eq(clients.id, withSiteId));
    await db.delete(clients).where(eq(clients.id, otherSiteId));
    await db.delete(clients).where(eq(clients.id, noSiteId));
    if (ORIGINAL_KEY === undefined) delete process.env.ADS_INTERNAL_KEY;
    else process.env.ADS_INTERNAL_KEY = ORIGINAL_KEY;
    if (ORIGINAL_WORKSPACE === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
    else process.env.ADS_INTERNAL_WORKSPACE_ID = ORIGINAL_WORKSPACE;
    await closeDb();
  });

  function ownerHeaders(): Record<string, string> {
    return { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
  }

  async function postSlug(clientId: string, slug: string, headers: Record<string, string>) {
    return app.request(`/clients/${clientId}/skills-profile`, {
      method: "POST",
      headers,
      body: JSON.stringify({ slug }),
    });
  }

  async function hvacRows() {
    const db = getDb();
    const clientRows = await db.select().from(skillClientConfigs).where(eq(skillClientConfigs.slug, "hvac-usa"));
    const storeRows = await db.select().from(skillStoreConfigs).where(eq(skillStoreConfigs.clientSlug, "hvac-usa"));
    return { clientRows, storeRows };
  }

  it("refuses an operator and the service key without writing", async () => {
    const before = await hvacRows();
    const operator = await postSlug(withSiteId, "hvac-usa", {
      authorization: `Bearer ${operatorToken}`,
      "content-type": "application/json",
    });
    expect(operator.status).toBe(403);
    const service = await postSlug(withSiteId, "hvac-usa", {
      "x-cerevex-internal-key": INTERNAL_KEY,
      "content-type": "application/json",
    });
    expect(service.status).toBe(403);
    const after = await hvacRows();
    expect(after.clientRows).toHaveLength(before.clientRows.length);
    expect(after.storeRows).toHaveLength(before.storeRows.length);
    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, "skills.profile_loaded")));
    expect(audits.filter((row) => row.entityId === withSiteId)).toHaveLength(0);
  });

  it("refuses an unknown slug, a client with no site, and a slug already linked to another client", async () => {
    const unknown = await postSlug(withSiteId, "not-a-profile", ownerHeaders());
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error).toMatch(/Unknown skills profile/);
    expect((await hvacRows()).clientRows).toHaveLength(0);

    const noSite = await postSlug(noSiteId, "hvac-usa", ownerHeaders());
    expect(noSite.status).toBe(400);
    expect((await json(noSite)).error).toMatch(/no site/i);
    expect((await hvacRows()).clientRows).toHaveLength(0);

    const loaded = await postSlug(withSiteId, "hvac-usa", ownerHeaders());
    expect(loaded.status).toBe(200);
    const taken = await postSlug(otherSiteId, "hvac-usa", ownerHeaders());
    expect(taken.status).toBe(409);
    expect((await json(taken)).error).toMatch(/already linked/);
    const rows = await hvacRows();
    expect(rows.clientRows).toHaveLength(1);
    expect(rows.clientRows[0]?.clientId).toBe(withSiteId);
    expect(rows.storeRows.every((row) => row.brainStoreId !== otherSite)).toBe(true);
  });

  it("loads hvac-usa for the owner, records the snapshot, and reloads in place", async () => {
    const bundle = importProfiles();
    const profile = bundle.clients.find((client) => client.slug === "hvac-usa");
    if (!profile) throw new Error("hvac-usa profile missing");

    const first = await postSlug(withSiteId, "hvac-usa", ownerHeaders());
    expect(first.status).toBe(200);
    const body = await json(first);
    expect(body.slug).toBe("hvac-usa");
    expect(body.clientId).toBe(withSiteId);
    expect(body.snapshotId).toBe(profile.snapshotId);
    expect(body.snapshotId).toBe(bundle.snapshotId);

    const rows = await hvacRows();
    expect(rows.clientRows).toHaveLength(1);
    expect(rows.clientRows[0]).toMatchObject({
      slug: "hvac-usa",
      clientId: withSiteId,
      snapshotId: profile.snapshotId,
    });
    const web = rows.storeRows.find((row) => row.storeKey === "hvac-usa/web");
    expect(web).toMatchObject({ role: "web", brainStoreId: siteId });
    expect(rows.storeRows.filter((row) => row.role === "web" || row.role === "service-area").every((row) => row.brainStoreId === siteId)).toBe(true);

    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.workspaceId, workspaceId),
          eq(auditLog.action, "skills.profile_loaded"),
          eq(auditLog.entityId, withSiteId),
        ),
      )
      .orderBy(desc(auditLog.createdAt));
    expect(audits.length).toBeGreaterThan(0);
    const latest = audits[0];
    expect(latest?.actorId).toBe(ownerId);
    expect(latest?.payloadJson).toMatchObject({
      slug: "hvac-usa",
      snapshotId: profile.snapshotId,
      clientId: withSiteId,
      brainStoreId: siteId,
    });

    const again = await postSlug(withSiteId, "hvac-usa", ownerHeaders());
    expect(again.status).toBe(200);
    expect((await json(again)).snapshotId).toBe(profile.snapshotId);
    const reloaded = await hvacRows();
    expect(reloaded.clientRows).toHaveLength(1);
    expect(reloaded.clientRows[0]?.clientId).toBe(withSiteId);
    expect(reloaded.clientRows[0]?.snapshotId).toBe(profile.snapshotId);
    expect(reloaded.storeRows).toHaveLength(rows.storeRows.length);
    expect(reloaded.storeRows.find((row) => row.storeKey === "hvac-usa/web")?.brainStoreId).toBe(siteId);
  });
});
