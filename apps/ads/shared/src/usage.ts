/**
 * Shared monthly usage counter for creative variations and SEO jobs.
 *
 * Server-only. This module is not on the root barrel, so ads-web cannot
 * import it through `@tharros/ads-shared`. The `./usage` export stays so
 * Brain's server job writer and vitest can load it under Node. It does not
 * import `server-only`: that package throws unless the react-server condition
 * is set, and the SEO job writer runs in Node.
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
};

export type UsageRecordResult = UsageSlice & {
  counted: boolean;
  alreadyRecorded: boolean;
};

type UsageWriteRow = {
  inserted: boolean;
  counted: boolean;
  used: number | null;
  period_key: string;
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

async function loadClient(tx: Tx, tenantId: string): Promise<{ id: string; workspaceId: string; plan: PlanId }> {
  const [client] = await tx
    .select({ id: clients.id, workspaceId: clients.workspaceId, plan: clients.plan })
    .from(clients)
    .where(eq(clients.id, tenantId));
  if (!client) throw new Error("Client not found");
  if (!isPlanId(client.plan)) throw new Error("This account's plan isn't recognized.");
  return { id: client.id, workspaceId: client.workspaceId, plan: client.plan };
}

/** Serializes usage writes for one client. Re-entrant inside the same transaction. */
export async function lockUsage(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('os.usage'), hashtext(${tenantId}::text))`);
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
  const counted = usageOutcomeCounts(input.outcome);
  // Usage-specific key so a count does not wait behind every location write.
  // Do not FOR UPDATE the client here. Idea inserts already hold KEY SHARE on
  // that row, and a stronger lock deadlocks a second save. READ COMMITTED
  // sees the other session's commit after this wait. The counter upsert stays
  // atomic (used = used + 1). The month comes from the database clock.
  await lockUsage(tx, input.tenantId);
  const client = await loadClient(tx, input.tenantId);

  const written = await tx.execute(sql`
    WITH clock AS (
      SELECT now() AS created_at,
             to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM') AS period_key
    ),
    inserted AS (
      INSERT INTO os.usage_events (
        workspace_id, client_id, kind, item_id, outcome, counted, period_key, created_at
      )
      SELECT
        ${client.workspaceId},
        ${client.id},
        ${input.kind},
        ${itemId},
        ${input.outcome},
        ${counted},
        clock.period_key,
        clock.created_at
      FROM clock
      ON CONFLICT (client_id, kind, item_id) DO NOTHING
      RETURNING counted
    ),
    bumped AS (
      INSERT INTO os.usage_counters (client_id, workspace_id, kind, period_key, used)
      SELECT ${client.id}, ${client.workspaceId}, ${input.kind}, (SELECT period_key FROM clock), 1
      FROM inserted
      WHERE counted
      ON CONFLICT (client_id, kind, period_key)
      DO UPDATE SET used = os.usage_counters.used + 1, updated_at = now()
      RETURNING used
    )
    SELECT
      EXISTS (SELECT 1 FROM inserted) AS inserted,
      COALESCE((SELECT counted FROM inserted), false) AS counted,
      (SELECT period_key FROM clock) AS period_key,
      COALESCE(
        (SELECT used FROM bumped),
        (
          SELECT c.used FROM os.usage_counters c
          WHERE c.client_id = ${client.id}
            AND c.kind = ${input.kind}
            AND c.period_key = (SELECT period_key FROM clock)
        ),
        0
      ) AS used
  `);
  const row = rowsOf(written)[0];
  if (!row) throw new Error("Usage count did not return a row.");
  const used = row.used == null ? 0 : Number(row.used);
  const periodKey = row.period_key || usagePeriodKey(new Date());
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
 * One matching client is counted: a site link, or one active location.
 * Two clients for the same store is not a guess. The charge is skipped and
 * the caller reports it. No matching client means there is nothing to count,
 * and the caller should still keep the job. The month is stamped on the server.
 */
export async function recordUsageForStore(input: {
  storeId: string;
  kind: MonthlyCapId;
  itemId: string;
  outcome: UsageOutcome;
}): Promise<UsageRecordResult | { skipped: true; reason: "no_client" | "ambiguous_client" }> {
  const db = getDb();
  const bySite = await db.select({ id: clients.id }).from(clients).where(eq(clients.siteId, input.storeId));
  const byLocation = await db
    .select({ id: locations.clientId })
    .from(locations)
    .where(and(eq(locations.storeId, input.storeId), eq(locations.status, "active")));
  const tenantIds = [...new Set([...bySite.map((row) => row.id), ...byLocation.map((row) => row.id)])];
  if (tenantIds.length === 0) return { skipped: true, reason: "no_client" };
  if (tenantIds.length > 1) return { skipped: true, reason: "ambiguous_client" };
  return recordUsage({
    tenantId: tenantIds[0]!,
    kind: input.kind,
    itemId: input.itemId,
    outcome: input.outcome,
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
 * Does not record anything and does not lock. Paid always passes. Scholarship
 * passes while `used` is below the limit.
 *
 * This is not a safe concurrent gate. Callers that all read the same `used`
 * can each pass and then each record: 10 creates at used=19 can all pass and
 * the counter stores 29. A future gate has to check and increment inside the
 * locked writeUsage. This helper does not refuse the 21st. Creation still
 * counts and reports.
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
