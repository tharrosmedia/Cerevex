/**
 * Shared monthly usage counter for creative variations and SEO jobs.
 *
 * recordUsage / getUsage / assertWithinCap are the helpers. Creation paths
 * call recordUsage. It counts once per item id and does not block the create.
 * assertWithinCap is the check a later screen can call. Paid is unlimited and
 * still counted. Nothing here bills or sends mail.
 */
import {
  isPlanId,
  isUsageOutcome,
  isWithinMonthlyLimit,
  monthlyLimitMessage,
  monthlyUsageLimit,
  usageOutcomeCounts,
  usagePeriodKey,
  type MonthlyCapId,
  type PlanId,
  type UsageOutcome,
} from "@cerevex/contracts";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { clients, locations, usageCounters } from "./schema";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class UsageLimitError extends Error {
  readonly status = 409 as const;

  constructor(message: string) {
    super(message);
    this.name = "UsageLimitError";
  }
}

export type UsageSlice = {
  kind: MonthlyCapId;
  used: number;
  limit: number | null;
  periodKey: string;
  withinCap: boolean;
};

export type UsageSnapshot = {
  tenantId: string;
  plan: PlanId;
  periodKey: string;
  creativeVariations: UsageSlice;
  seoJobs: UsageSlice;
};

export type UsageRecordInput = {
  tenantId: string;
  kind: MonthlyCapId;
  itemId: string;
  outcome: UsageOutcome;
  createdAt?: Date;
};

export type UsageRecordResult = UsageSlice & {
  counted: boolean;
  alreadyRecorded: boolean;
};

type UsageWriteRow = {
  inserted: boolean;
  counted: boolean;
  used: number | null;
};

function slice(kind: MonthlyCapId, plan: PlanId, used: number, periodKey: string): UsageSlice {
  const limit = monthlyUsageLimit(plan, kind);
  return {
    kind,
    used,
    limit,
    periodKey,
    withinCap: isWithinMonthlyLimit(used, limit),
  };
}

async function loadClient(
  tx: Tx,
  tenantId: string,
  lock = false,
): Promise<{ id: string; workspaceId: string; plan: PlanId }> {
  const query = tx
    .select({ id: clients.id, workspaceId: clients.workspaceId, plan: clients.plan })
    .from(clients)
    .where(eq(clients.id, tenantId));
  const [client] = await (lock ? query.for("update") : query);
  if (!client) throw new Error("Client not found");
  if (!isPlanId(client.plan)) throw new Error("This account's plan isn't recognized.");
  return { id: client.id, workspaceId: client.workspaceId, plan: client.plan };
}

function rowsOf(result: unknown): UsageWriteRow[] {
  if (Array.isArray(result)) return result as UsageWriteRow[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: UsageWriteRow[] }).rows;
  }
  return [];
}

async function writeUsage(tx: Tx, input: UsageRecordInput): Promise<UsageRecordResult> {
  const itemId = input.itemId.trim();
  if (!itemId) throw new Error("A usage item id is required.");
  if (!isUsageOutcome(input.outcome)) throw new Error("That usage outcome isn't recognized.");
  const createdAt = input.createdAt ?? new Date();
  const periodKey = usagePeriodKey(createdAt);
  const counted = usageOutcomeCounts(input.outcome);
  // Usage-specific key so a count does not wait behind every location write.
  // READ COMMITTED sees the other session's commit after this wait. The
  // counter upsert itself stays atomic (used = used + 1).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('os.usage'), hashtext(${input.tenantId}::text))`);
  const client = await loadClient(tx, input.tenantId, true);

  const written = await tx.execute(sql`
    WITH inserted AS (
      INSERT INTO os.usage_events (
        workspace_id, client_id, kind, item_id, outcome, counted, period_key, created_at
      ) VALUES (
        ${client.workspaceId},
        ${client.id},
        ${input.kind},
        ${itemId},
        ${input.outcome},
        ${counted},
        ${periodKey},
        ${createdAt}
      )
      ON CONFLICT (client_id, kind, item_id) DO NOTHING
      RETURNING counted
    ),
    bumped AS (
      INSERT INTO os.usage_counters (client_id, workspace_id, kind, period_key, used)
      SELECT ${client.id}, ${client.workspaceId}, ${input.kind}, ${periodKey}, 1
      FROM inserted
      WHERE counted
      ON CONFLICT (client_id, kind, period_key)
      DO UPDATE SET used = os.usage_counters.used + 1, updated_at = now()
      RETURNING used
    )
    SELECT
      EXISTS (SELECT 1 FROM inserted) AS inserted,
      COALESCE((SELECT counted FROM inserted), false) AS counted,
      COALESCE(
        (SELECT used FROM bumped),
        (
          SELECT c.used FROM os.usage_counters c
          WHERE c.client_id = ${client.id}
            AND c.kind = ${input.kind}
            AND c.period_key = ${periodKey}
        ),
        0
      ) AS used
  `);
  const row = rowsOf(written)[0];
  if (!row) throw new Error("Usage count did not return a row.");
  const used = row.used == null ? 0 : Number(row.used);
  return {
    ...slice(input.kind, client.plan, used, periodKey),
    counted: Boolean(row?.inserted) && Boolean(row?.counted),
    alreadyRecorded: !row?.inserted,
  };
}

/** Count one creative variation or SEO job. Safe to call again with the same item id. */
export async function recordUsage(input: UsageRecordInput, tx?: Tx): Promise<UsageRecordResult> {
  if (tx) return writeUsage(tx, input);
  return getDb().transaction((inner) => writeUsage(inner, input));
}

/**
 * SEO and other Brain jobs know a store id, not an OS client id.
 * Site link wins. An active location is the fallback. No matching client
 * means there is nothing to count, and the caller should still keep the job.
 */
export async function recordUsageForStore(input: {
  storeId: string;
  kind: MonthlyCapId;
  itemId: string;
  outcome: UsageOutcome;
  createdAt?: Date;
}): Promise<UsageRecordResult | { skipped: true; reason: "no_client" }> {
  const db = getDb();
  const [bySite] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.siteId, input.storeId))
    .limit(1);
  if (bySite) {
    return recordUsage({
      tenantId: bySite.id,
      kind: input.kind,
      itemId: input.itemId,
      outcome: input.outcome,
      createdAt: input.createdAt,
    });
  }
  const [byLocation] = await db
    .select({ id: locations.clientId })
    .from(locations)
    .where(and(eq(locations.storeId, input.storeId), eq(locations.status, "active")))
    .limit(1);
  if (!byLocation) return { skipped: true, reason: "no_client" };
  return recordUsage({
    tenantId: byLocation.id,
    kind: input.kind,
    itemId: input.itemId,
    outcome: input.outcome,
    createdAt: input.createdAt,
  });
}

export async function getUsage(tenantId: string, at: Date = new Date()): Promise<UsageSnapshot> {
  const periodKey = usagePeriodKey(at);
  return getDb().transaction(async (tx) => {
    const client = await loadClient(tx, tenantId);
    const rows = await tx
      .select({ kind: usageCounters.kind, used: usageCounters.used })
      .from(usageCounters)
      .where(and(eq(usageCounters.clientId, tenantId), eq(usageCounters.periodKey, periodKey)));
    const usedFor = (kind: MonthlyCapId) => rows.find((row) => row.kind === kind)?.used ?? 0;
    return {
      tenantId,
      plan: client.plan,
      periodKey,
      creativeVariations: slice("creative_variations", client.plan, usedFor("creative_variations"), periodKey),
      seoJobs: slice("seo_jobs", client.plan, usedFor("seo_jobs"), periodKey),
    };
  });
}

/**
 * Reports whether another countable item would still be inside the limit.
 * Does not record anything. Paid always passes. Scholarship passes while
 * `used` is below the limit.
 */
export async function assertWithinCap(
  tenantId: string,
  kind: MonthlyCapId,
  at: Date = new Date(),
): Promise<UsageSlice> {
  const usage = await getUsage(tenantId, at);
  const current = kind === "creative_variations" ? usage.creativeVariations : usage.seoJobs;
  if (!current.withinCap) throw new UsageLimitError(monthlyLimitMessage(kind));
  return current;
}
