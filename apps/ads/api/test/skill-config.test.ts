import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { importProfiles } from "@cerevex/skills";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import {
  clients,
  memberships,
  skillClientConfigs,
  skillStoreConfigs,
  users,
  workspaces,
} from "@tharros/ads-shared/schema";
import { assertLocalDatabase, importSkillConfigBundle, resolveSkillClientLink } from "@tharros/ads-shared";
import { and, eq } from "drizzle-orm";

const IN_SCOPE = [
  "hvac-usa",
  "got-ductless",
  "kc-prestige-hvac",
  "elmar-hvac",
  "tharros-media",
  "cerevex",
] as const;

const EXTRA_CLIENT_NAMES = ["HVAC USA", "Tharros Media", "Cerevex"] as const;

describe("skill config import", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("refuses a non-local database host", () => {
    expect(() => assertLocalDatabase("postgres://user:pass@ep-example.neon.tech/cerevex")).toThrow(/non-local/);
    expect(() => assertLocalDatabase("postgres://tharros:tharros@127.0.0.1:54329/tharros")).not.toThrow();
  });

  it("links by alias, including a row named KC Prestige HVAC", () => {
    const rows = [
      { id: "hvac", name: "HVAC USA" },
      { id: "got", name: "Got Ductless" },
      { id: "kc", name: "KC Prestige HVAC" },
      { id: "elmar", name: "Elmar HVAC" },
      { id: "tharros", name: "Tharros Media" },
      { id: "cerevex", name: "Cerevex" },
    ];
    for (const slug of IN_SCOPE) {
      const link = resolveSkillClientLink(slug, rows);
      expect(link.warning).toBeNull();
      expect(link.clientId).toBeTruthy();
    }
    expect(resolveSkillClientLink("kc-prestige-hvac", rows).clientId).toBe("kc");
    expect(resolveSkillClientLink("kc-prestige-hvac", [{ id: "seed", name: "KC Prestige" }])).toEqual({
      clientId: "seed",
      warning: null,
    });
    const unknown = resolveSkillClientLink("not-a-client", rows);
    expect(unknown.clientId).toBeNull();
    expect(unknown.warning).toMatch(/Unknown client/);
  });

  it("upserts in-scope clients, links every os.clients row, and blocks a Level Agency slug", async () => {
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.name, "Tharros Media"),
    });
    if (!workspace) throw new Error("Seed workspace missing");
    const owner = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspace.id), eq(memberships.role, "owner")));
    expect(owner).toHaveLength(1);

    const bundle = importProfiles();
    const before = await importSkillConfigBundle(db, bundle);
    const seeded = await db.select().from(clients).where(eq(clients.workspaceId, workspace.id));
    const kcSeed = seeded.find((row) => row.name === "KC Prestige");
    const gotSeed = seeded.find((row) => row.name === "Got Ductless");
    const elmarSeed = seeded.find((row) => row.name === "Elmar HVAC");
    expect(kcSeed && gotSeed && elmarSeed).toBeTruthy();
    expect(before.links.find((link) => link.slug === "kc-prestige-hvac")).toEqual({
      slug: "kc-prestige-hvac",
      clientId: kcSeed?.id,
      warning: null,
    });
    expect(before.links.find((link) => link.slug === "got-ductless")?.clientId).toBe(gotSeed?.id);
    expect(before.links.find((link) => link.slug === "elmar-hvac")?.clientId).toBe(elmarSeed?.id);
    for (const slug of ["hvac-usa", "tharros-media", "cerevex"] as const) {
      const link = before.links.find((item) => item.slug === slug);
      expect(link?.clientId).toBeNull();
      expect(link?.warning).toMatch(/No os.clients row/);
    }
    expect(before.approvalOwnerUserId).toBe(owner[0]?.userId);

    try {
      for (const name of EXTRA_CLIENT_NAMES) {
        await db
          .insert(clients)
          .values({ workspaceId: workspace.id, name, pilotFlag: false, status: "active" })
          .onConflictDoNothing();
      }
      const present = await db.select().from(clients).where(eq(clients.workspaceId, workspace.id));
      const after = await importSkillConfigBundle(db, bundle);
      const rows = await db.select().from(skillClientConfigs);
      expect(rows.map((row) => row.slug).sort()).toEqual([...IN_SCOPE].sort());
      for (const slug of IN_SCOPE) {
        const link = after.links.find((item) => item.slug === slug);
        const row = rows.find((item) => item.slug === slug);
        expect(link?.warning).toBeNull();
        expect(link?.clientId).toBeTruthy();
        expect(row?.clientId).toBe(link?.clientId);
        expect(row?.approvalOwnerResolved).toBe("agency owner (Adam Leech)");
        expect(row?.approvalOwnerUserId).toBe(owner[0]?.userId);
        const aliases =
          slug === "kc-prestige-hvac"
            ? ["KC Prestige HVAC", "KC Prestige"]
            : slug === "tharros-media"
              ? ["Tharros Media", "Tharros Media (agency brand)"]
              : [present.find((client) => client.id === link?.clientId)?.name];
        expect(aliases).toContain(present.find((client) => client.id === link?.clientId)?.name);
      }
      const kc = rows.find((row) => row.slug === "kc-prestige-hvac");
      expect(kc?.displayName).toBe("KC Prestige HVAC");
      expect(kc?.clientId).toBe(kcSeed?.id);
      const cerevex = rows.find((row) => row.slug === "cerevex");
      expect(cerevex?.marketingGate).toBe("on");
      const hvac = rows.find((row) => row.slug === "hvac-usa");
      expect(hvac?.pilot).toBe(true);
      expect(hvac?.clientId).toBe(present.find((client) => client.name === "HVAC USA")?.id);

      const stores = await db
        .select()
        .from(skillStoreConfigs)
        .where(eq(skillStoreConfigs.clientSlug, "got-ductless"));
      expect(stores.map((store) => store.storeKey).sort()).toEqual([
        "got-ductless/maryland",
        "got-ductless/web",
      ]);
    } finally {
      for (const name of EXTRA_CLIENT_NAMES) {
        await db
          .delete(clients)
          .where(and(eq(clients.workspaceId, workspace.id), eq(clients.name, name)));
      }
    }

    await expect(
      db.execute(sql`
        insert into os.skill_client_configs (
          slug, display_name, snapshot_id, profile_hash, marketing_gate,
          scope_allowed, pilot, approval_owner_resolved, config_json, missing_facts_json
        ) values (
          'edge-nyc', 'Edge NYC', 'x', 'x', 'off', true, false, 'agency owner (Adam Leech)', '{}'::jsonb, '[]'::jsonb
        )
      `),
    ).rejects.toThrow();
  });

  it("leaves an unknown client unlinked when the bundle names one", async () => {
    const db = getDb();
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    expect(existing.length).toBeGreaterThan(0);
    const rows = await db.select({ id: clients.id, name: clients.name }).from(clients);
    const unknown = resolveSkillClientLink("level-agency-example", rows);
    expect(unknown.clientId).toBeNull();
    expect(unknown.warning).toMatch(/Unknown client slug "level-agency-example"/);
  });
});
