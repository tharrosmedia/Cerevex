import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { importProfiles } from "@cerevex/skills";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { skillClientConfigs, skillStoreConfigs } from "@tharros/ads-shared/schema";
import { assertLocalDatabase, importSkillConfigBundle } from "@tharros/ads-shared";
import { eq } from "drizzle-orm";

describe("skill config import", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("refuses a non-local database host", () => {
    expect(() => assertLocalDatabase("postgres://user:pass@ep-example.neon.tech/cerevex")).toThrow(/non-local/);
    expect(() => assertLocalDatabase("postgres://tharros:tharros@127.0.0.1:54329/tharros")).not.toThrow();
  });

  it("upserts in-scope clients and blocks a Level Agency slug", async () => {
    const db = getDb();
    const bundle = importProfiles();
    await importSkillConfigBundle(db, bundle);

    const rows = await db.select().from(skillClientConfigs);
    expect(rows.map((row) => row.slug).sort()).toEqual([
      "cerevex",
      "elmar-hvac",
      "got-ductless",
      "hvac-usa",
      "kc-prestige-hvac",
      "tharros-media",
    ]);
    const cerevex = rows.find((row) => row.slug === "cerevex");
    expect(cerevex?.marketingGate).toBe("on");
    expect(cerevex?.approvalOwnerResolved).toBe("Adam");
    const hvac = rows.find((row) => row.slug === "hvac-usa");
    expect(hvac?.pilot).toBe(true);
    const got = rows.find((row) => row.slug === "got-ductless");
    expect(got?.clientId).toBeTruthy();
    const kc = rows.find((row) => row.slug === "kc-prestige-hvac");
    expect(kc?.clientId).toBeNull();

    const stores = await db
      .select()
      .from(skillStoreConfigs)
      .where(eq(skillStoreConfigs.clientSlug, "got-ductless"));
    expect(stores.map((store) => store.storeKey).sort()).toEqual([
      "got-ductless/maryland",
      "got-ductless/web",
    ]);

    await expect(
      db.execute(sql`
        insert into os.skill_client_configs (
          slug, display_name, snapshot_id, profile_hash, marketing_gate,
          scope_allowed, pilot, approval_owner_resolved, config_json, missing_facts_json
        ) values (
          'edge-nyc', 'Edge NYC', 'x', 'x', 'off', true, false, 'Adam', '{}'::jsonb, '[]'::jsonb
        )
      `),
    ).rejects.toThrow();
  });
});