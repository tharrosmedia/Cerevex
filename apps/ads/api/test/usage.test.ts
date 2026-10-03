import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { monthlyLimitMessage, usagePeriodKey } from "@cerevex/contracts";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { clients, locations, usageEvents, workspaces } from "@tharros/ads-shared/schema";
import { getEntitlements } from "@tharros/ads-shared/entitlements";
import { saveGrokIdea } from "@tharros/ads-shared/grok-creatives";
import {
  UsageLimitError,
  assertWithinCap,
  getUsage,
  recordUsage,
  recordUsageForStore,
} from "@tharros/ads-shared/usage";

loadEnv();

const NAMES = [
  "Usage Period",
  "Usage Cap",
  "Usage Race",
  "Usage Paid",
  "Usage Outcome",
  "Usage Path",
  "Usage Saves",
];

describe("usage month in America/New_York", () => {
  it("splits 23:59 and 00:00 on a calendar boundary", () => {
    expect(usagePeriodKey(new Date("2026-04-01T03:59:00.000Z"))).toBe("2026-03");
    expect(usagePeriodKey(new Date("2026-04-01T04:00:00.000Z"))).toBe("2026-04");
  });

  it("uses Eastern Standard Time in March and Eastern Daylight Time in April and November", () => {
    expect(usagePeriodKey(new Date("2026-03-01T04:59:00.000Z"))).toBe("2026-02");
    expect(usagePeriodKey(new Date("2026-03-01T05:00:00.000Z"))).toBe("2026-03");
    expect(usagePeriodKey(new Date("2026-04-01T03:59:00.000Z"))).toBe("2026-03");
    expect(usagePeriodKey(new Date("2026-04-01T04:00:00.000Z"))).toBe("2026-04");
    expect(usagePeriodKey(new Date("2026-11-01T03:59:00.000Z"))).toBe("2026-10");
    expect(usagePeriodKey(new Date("2026-11-01T04:00:00.000Z"))).toBe("2026-11");
    expect(usagePeriodKey(new Date("2026-11-01T05:30:00.000Z"))).toBe("2026-11");
    expect(usagePeriodKey(new Date("2026-11-01T06:30:00.000Z"))).toBe("2026-11");
  });

  it("names the next 1st and the paid plan when the month is used up", () => {
    expect(monthlyLimitMessage("creative_variations", new Date("2026-10-03T16:00:00.000Z"))).toBe(
      "You've used all 20 creative variations this month. More on November 1, or move to the paid plan for unlimited.",
    );
    expect(monthlyLimitMessage("seo_jobs", new Date("2026-12-15T17:00:00.000Z"))).toBe(
      "You've used all 10 SEO jobs this month. More on January 1, 2027, or move to the paid plan for unlimited.",
    );
    expect(monthlyLimitMessage("creative_variations", new Date("2026-10-03T16:00:00.000Z"))).not.toMatch(
      /tenant|entitlement|\bcap\b/i,
    );
  });
});

describe("monthly usage counters", () => {
  let workspaceId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.name, "Tharros Media") });
    if (!workspace) throw new Error("Seed workspace missing. Run npm run ads:db:seed first.");
    workspaceId = workspace.id;
    await db.delete(clients).where(inArray(clients.name, NAMES));
    const plans = [
      ["Usage Period", "scholarship"],
      ["Usage Cap", "scholarship"],
      ["Usage Race", "scholarship"],
      ["Usage Paid", "paid"],
      ["Usage Outcome", "scholarship"],
      ["Usage Path", "scholarship"],
      ["Usage Saves", "scholarship"],
    ] as const;
    for (const [name, plan] of plans) {
      const [row] = await db.insert(clients).values({ workspaceId, name, status: "active", plan }).returning();
      ids[name] = row.id;
    }
  });

  afterAll(async () => {
    await getDb().delete(clients).where(inArray(clients.name, NAMES));
    await closeDb();
  });

  it("keeps the kill switch on", async () => {
    const workspace = await getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    expect(workspace?.applyKillSwitch).toBe(true);
  });

  it("stamps the count on the server clock in the current Eastern month", async () => {
    const tenantId = ids["Usage Period"];
    const before = Date.now();
    const recorded = await recordUsage({
      tenantId,
      kind: "seo_jobs",
      itemId: "server-clock",
      outcome: "created",
    });
    expect(recorded.periodKey).toBe(usagePeriodKey(new Date()));
    expect(recorded.counted).toBe(true);
    const [row] = await getDb().select().from(usageEvents).where(eq(usageEvents.clientId, tenantId));
    expect(row?.periodKey).toBe(usagePeriodKey(new Date()));
    expect(row?.createdAt.getTime()).toBeGreaterThan(before - 5_000);
    expect(row?.createdAt.getTime()).toBeLessThan(Date.now() + 5_000);
    expect((await getUsage(tenantId)).seoJobs.used).toBe(1);
  });

  it("does not count rejected, duplicate, or merged items", async () => {
    const tenantId = ids["Usage Outcome"];
    for (const outcome of ["rejected", "duplicate", "merged"] as const) {
      const recorded = await recordUsage({
        tenantId,
        kind: "seo_jobs",
        itemId: outcome,
        outcome,
      });
      expect(recorded.counted).toBe(false);
      expect(recorded.used).toBe(0);
    }
    const created = await recordUsage({
      tenantId,
      kind: "seo_jobs",
      itemId: "kept",
      outcome: "created",
    });
    expect(created.counted).toBe(true);
    expect((await getUsage(tenantId)).seoJobs.used).toBe(1);
    const events = await getDb().select().from(usageEvents).where(eq(usageEvents.clientId, tenantId));
    expect(events).toHaveLength(4);
    expect(events.filter((row) => row.counted)).toHaveLength(1);
  });

  it("counts an item once when the same id is recorded again", async () => {
    const tenantId = ids["Usage Outcome"];
    const first = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: "same-idea",
      outcome: "created",
    });
    const retry = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: "same-idea",
      outcome: "created",
    });
    expect(first.counted).toBe(true);
    expect(retry.counted).toBe(false);
    expect(retry.alreadyRecorded).toBe(true);
    expect(retry.used).toBe(1);

    const rejected = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: "rejected-first",
      outcome: "rejected",
    });
    const rewritten = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: "rejected-first",
      outcome: "created",
    });
    expect(rejected.counted).toBe(false);
    expect(rewritten.alreadyRecorded).toBe(true);
    expect(rewritten.counted).toBe(false);
    expect((await getUsage(tenantId)).creativeVariations.used).toBe(1);
  });

  it("counts a paid tenant with no limit", async () => {
    const tenantId = ids["Usage Paid"];
    for (let i = 1; i <= 25; i += 1) {
      await recordUsage({
        tenantId,
        kind: "creative_variations",
        itemId: `paid-${i}`,
        outcome: "created",
      });
    }
    const usage = await getUsage(tenantId);
    expect(usage.plan).toBe("paid");
    expect(usage.creativeVariations).toMatchObject({ used: 25, limit: null, withinCap: true });
    await expect(assertWithinCap(tenantId, "creative_variations")).resolves.toMatchObject({ used: 25 });
  });

  it("reports scholarship usage at 19, 20, and 21 without refusing the 21st", async () => {
    const tenantId = ids["Usage Cap"];
    for (let i = 1; i <= 19; i += 1) {
      await recordUsage({
        tenantId,
        kind: "creative_variations",
        itemId: `cap-${i}`,
        outcome: "created",
      });
    }
    expect(await assertWithinCap(tenantId, "creative_variations")).toMatchObject({
      used: 19,
      limit: 20,
      withinCap: true,
    });

    const twentieth = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: "cap-20",
      outcome: "created",
    });
    expect(twentieth).toMatchObject({ counted: true, used: 20, limit: 20, withinCap: false });
    await expect(assertWithinCap(tenantId, "creative_variations")).rejects.toBeInstanceOf(UsageLimitError);

    const twentyFirst = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: "cap-21",
      outcome: "created",
    });
    expect(twentyFirst).toMatchObject({ counted: true, used: 21, withinCap: false });
    expect((await getUsage(tenantId)).creativeVariations.used).toBe(21);
    const view = await getEntitlements(tenantId);
    expect(view.monthly.creativeVariations).toMatchObject({ limit: 20, used: 21 });
    expect(view.monthly.seoJobs).toMatchObject({ limit: 10, used: 0 });
  });

  it("does not lose an increment when two inserts race at one under the limit", async () => {
    const tenantId = ids["Usage Race"];
    for (let i = 1; i <= 19; i += 1) {
      await recordUsage({
        tenantId,
        kind: "creative_variations",
        itemId: `race-${i}`,
        outcome: "created",
      });
    }
    const [left, right] = await Promise.all([
      recordUsage({
        tenantId,
        kind: "creative_variations",
        itemId: "race-left",
        outcome: "created",
      }),
      recordUsage({
        tenantId,
        kind: "creative_variations",
        itemId: "race-right",
        outcome: "created",
      }),
    ]);
    expect(left.counted).toBe(true);
    expect(right.counted).toBe(true);
    expect(new Set([left.used, right.used])).toEqual(new Set([20, 21]));
    expect((await getUsage(tenantId)).creativeVariations.used).toBe(21);
  });

  it("counts a saved creative variation once, and an SEO job through the store link", async () => {
    const tenantId = ids["Usage Path"];
    const saved = await saveGrokIdea({
      workspaceId,
      clientId: tenantId,
      title: "June variation",
      alternative: {
        headline: "Same-week visit",
        body: "Factory-trained techs.",
        offer: "",
        videoScript: "Open on the home.",
        assets: [],
        targetPlatform: "meta",
        writes: false,
      },
    });
    const again = await recordUsage({
      tenantId,
      kind: "creative_variations",
      itemId: saved.ideaId,
      outcome: "created",
    });
    expect(again.alreadyRecorded).toBe(true);
    expect((await getUsage(tenantId, new Date())).creativeVariations.used).toBe(1);
    expect((await getEntitlements(tenantId)).monthly.creativeVariations.used).toBe(1);

    await getDb().update(clients).set({ siteId: "usage-store-1" }).where(eq(clients.id, tenantId));
    const fromSite = await recordUsageForStore({
      storeId: "usage-store-1",
      kind: "seo_jobs",
      itemId: "job-1",
      outcome: "created",
    });
    expect(fromSite).toMatchObject({ counted: true, used: 1 });
    const retry = await recordUsageForStore({
      storeId: "usage-store-1",
      kind: "seo_jobs",
      itemId: "job-1",
      outcome: "created",
    });
    expect(retry).toMatchObject({ counted: false, alreadyRecorded: true, used: 1 });

    const otherId = ids["Usage Paid"];
    await getDb().insert(locations).values({
      workspaceId,
      clientId: otherId,
      storeId: "usage-store-2",
      status: "active",
    });
    const fromLocation = await recordUsageForStore({
      storeId: "usage-store-2",
      kind: "seo_jobs",
      itemId: "job-2",
      outcome: "created",
    });
    expect(fromLocation).toMatchObject({ counted: true, used: 1, limit: null });
    expect(await recordUsageForStore({
      storeId: "missing-store",
      kind: "seo_jobs",
      itemId: "job-3",
      outcome: "created",
    })).toEqual({ skipped: true, reason: "no_client" });
  });

  it("picks the same client when two active locations share a store id", async () => {
    const left = ids["Usage Saves"];
    const right = ids["Usage Race"];
    const expected = [left, right].sort()[0];
    await getDb().insert(locations).values([
      { workspaceId, clientId: left, storeId: "usage-store-shared", status: "active" },
      { workspaceId, clientId: right, storeId: "usage-store-shared", status: "active" },
    ]);
    const recorded = await recordUsageForStore({
      storeId: "usage-store-shared",
      kind: "seo_jobs",
      itemId: "shared-store-job",
      outcome: "created",
    });
    expect(recorded).toMatchObject({ counted: true });
    const again = await recordUsageForStore({
      storeId: "usage-store-shared",
      kind: "seo_jobs",
      itemId: "shared-store-job-2",
      outcome: "created",
    });
    expect(again).toMatchObject({ counted: true });
    const usage = await getUsage(expected);
    expect(usage.seoJobs.used).toBe(2);
    const other = expected === left ? right : left;
    expect((await getUsage(other)).seoJobs.used).toBe(0);
  });

  it("saves 12 creative variations at once with no deadlocks and an exact count", async () => {
    const tenantId = ids["Usage Saves"];
    const alternative = {
      headline: "Same-week visit",
      body: "Factory-trained techs.",
      offer: "",
      videoScript: "Open on the home.",
      assets: [],
      targetPlatform: "meta" as const,
      writes: false as const,
    };
    const saved = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        saveGrokIdea({
          workspaceId,
          clientId: tenantId,
          title: `Variation ${index}`,
          alternative,
        }),
      ),
    );
    expect(new Set(saved.map((row) => row.ideaId)).size).toBe(12);
    expect((await getUsage(tenantId)).creativeVariations.used).toBe(12);
  });
});
