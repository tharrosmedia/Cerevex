/**
 * Server-side plan checks. The tenant is the OS client id.
 *
 * getEntitlements reports the plan. precheckCanActivateAdAccounts is an
 * unlocked batch pre-check for the connect screen. It does not lock the
 * client row. The real guards are activateStore and rejectAdAccountIfBlocked,
 * which lock the client row with NO KEY UPDATE and check again before writing.
 * Triggers use that same lock, and only when the write can add an active row.
 * setClientPlan refuses an over-limit move to Scholarship and turns nothing
 * off. Monthly counters are not stored here.
 */
import {
  SCHOLARSHIP_AD_ACCOUNTS_PER_PLATFORM,
  SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE,
  SCHOLARSHIP_LOCATION_LIMIT,
  adAccountLimitPerPlatform,
  decideAdAccountActivation,
  decideAdAccountActivations,
  decideLocationActivation,
  isActiveAdAccountStatus,
  isPlanId,
  locationLimit,
  monthlyCapsFor,
  scholarshipDowngradeAdAccountMessage,
  type PlanId,
  type TenantEntitlements,
} from "@cerevex/contracts";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { adAccounts, clients, locations } from "./schema";

export class EntitlementError extends Error {
  readonly status: 404 | 409;

  constructor(message: string, status: 404 | 409 = 409) {
    super(message);
    this.name = "EntitlementError";
    this.status = status;
  }
}

type TenantRow = typeof clients.$inferSelect;
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Pick<Tx, "select">;

function planOf(row: TenantRow): PlanId {
  if (isPlanId(row.plan)) return row.plan;
  throw new EntitlementError("This account's plan isn't recognized.");
}

async function lockTenant(tx: Tx, tenantId: string): Promise<TenantRow> {
  // NO KEY UPDATE serializes plan writes and does not block a foreign-key KEY SHARE.
  const [row] = await tx.select().from(clients).where(eq(clients.id, tenantId)).for("no key update");
  if (!row) throw new EntitlementError("Client not found", 404);
  return row;
}

async function activeStoreIds(tx: Reader, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ storeId: locations.storeId })
    .from(locations)
    .where(and(eq(locations.clientId, tenantId), eq(locations.status, "active")));
  return rows.map((row) => row.storeId);
}

async function activeExternalIds(tx: Reader, tenantId: string, platform: string): Promise<string[]> {
  const rows = await tx
    .select({
      externalId: adAccounts.externalId,
      connectionStatus: adAccounts.connectionStatus,
    })
    .from(adAccounts)
    .where(and(eq(adAccounts.clientId, tenantId), sql`${adAccounts.platform} = ${platform}`));
  return rows.filter((row) => isActiveAdAccountStatus(row.connectionStatus)).map((row) => row.externalId);
}

export async function withTenantWriteLock<T>(
  tenantId: string,
  write: (tx: Tx, tenant: TenantRow) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    const tenant = await lockTenant(tx, tenantId);
    return write(tx, tenant);
  });
}

/** Check and write share the tenant row lock. */
export async function rejectAdAccountIfBlocked(
  tx: Tx,
  tenant: TenantRow,
  platform: string,
  externalId: string,
  replacingExternalId?: string | null,
): Promise<void> {
  const decision = decideAdAccountActivation({
    plan: planOf(tenant),
    platform,
    activeExternalIds: await activeExternalIds(tx, tenant.id, platform),
    externalId,
    replacingExternalId,
  });
  if (!decision.allowed) throw new EntitlementError(decision.message);
}

export async function getEntitlements(tenantId: string): Promise<TenantEntitlements> {
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.id, tenantId) });
  if (!client) throw new EntitlementError("Client not found", 404);
  const plan = planOf(client);

  const locationRows = await db
    .select({ storeId: locations.storeId })
    .from(locations)
    .where(and(eq(locations.clientId, tenantId), eq(locations.status, "active")));

  const accountRows = await db
    .select({
      platform: adAccounts.platform,
      connectionStatus: adAccounts.connectionStatus,
    })
    .from(adAccounts)
    .where(eq(adAccounts.clientId, tenantId));

  const activeByPlatform: Record<string, number> = {};
  for (const row of accountRows) {
    if (!isActiveAdAccountStatus(row.connectionStatus)) continue;
    activeByPlatform[row.platform] = (activeByPlatform[row.platform] ?? 0) + 1;
  }

  return {
    tenantId: client.id,
    plan,
    locations: {
      limit: locationLimit(plan),
      activeCount: locationRows.length,
    },
    adAccounts: {
      limitPerPlatform: adAccountLimitPerPlatform(plan),
      activeByPlatform,
    },
    monthly: monthlyCapsFor(plan),
  };
}

/**
 * Unlocked UX pre-check for a whole connect batch. Does not lock the client
 * row and writes nothing. rejectAdAccountIfBlocked, inside the connect
 * write, is the real guard.
 */
export async function precheckCanActivateAdAccounts(
  tenantId: string,
  platform: string,
  externalIds: readonly string[],
  options?: { replacingExternalIds?: readonly string[] },
): Promise<void> {
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.id, tenantId) });
  if (!client) throw new EntitlementError("Client not found", 404);
  const activeExternalIdsForPlatform = await activeExternalIds(db, tenantId, platform);
  // A leftover "pending" row is the slot being filled, not a second account.
  const replacingExternalIds =
    options?.replacingExternalIds ??
    (activeExternalIdsForPlatform.length === 1 && activeExternalIdsForPlatform[0] === "pending"
      ? ["pending"]
      : []);
  const decision = decideAdAccountActivations({
    plan: planOf(client),
    platform,
    activeExternalIds: activeExternalIdsForPlatform,
    externalIds,
    replacingExternalIds,
  });
  if (!decision.allowed) throw new EntitlementError(decision.message);
}

async function activateStoreLocked(
  tx: Tx,
  tenantId: string,
  storeId: string,
  options?: { replacingStoreId?: string | null },
): Promise<typeof locations.$inferSelect> {
  const client = await lockTenant(tx, tenantId);
  const decision = decideLocationActivation({
    plan: planOf(client),
    storeId,
    activeStoreIds: await activeStoreIds(tx, tenantId),
    replacingStoreId: options?.replacingStoreId,
  });
  if (!decision.allowed) throw new EntitlementError(decision.message);

  const replacing = options?.replacingStoreId;
  if (replacing && replacing !== storeId) {
    await tx
      .update(locations)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(and(eq(locations.clientId, tenantId), eq(locations.storeId, replacing)));
  }

  const [row] = await tx
    .insert(locations)
    .values({
      workspaceId: client.workspaceId,
      clientId: client.id,
      storeId,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [locations.clientId, locations.storeId],
      set: { status: "active", updatedAt: new Date() },
    })
    .returning();
  return row;
}

/** Locks the client row, then turns the location off. Clears site_id when it points at this store. */
async function deactivateStoreLocked(
  tx: Tx,
  client: TenantRow,
  storeId: string,
): Promise<typeof locations.$inferSelect | null> {
  const [row] = await tx
    .update(locations)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(and(eq(locations.clientId, client.id), eq(locations.storeId, storeId)))
    .returning();
  if (row && client.siteId === storeId) {
    await tx.update(clients).set({ siteId: null }).where(eq(clients.id, client.id));
  }
  return row ?? null;
}

export async function activateStore(
  tenantId: string,
  storeId: string,
  options?: { replacingStoreId?: string | null },
): Promise<typeof locations.$inferSelect> {
  return getDb().transaction(async (tx) => activateStoreLocked(tx, tenantId, storeId, options));
}

export async function deactivateStore(
  tenantId: string,
  storeId: string,
): Promise<typeof locations.$inferSelect | null> {
  return withTenantWriteLock(tenantId, (tx, client) => deactivateStoreLocked(tx, client, storeId));
}

/**
 * Links or unlinks a site and the matching location in one transaction,
 * holding the client row lock for both writes.
 */
export async function assignClientSite(tenantId: string, siteId: string | null): Promise<TenantRow> {
  return withTenantWriteLock(tenantId, async (tx, client) => {
    if (siteId) {
      await activateStoreLocked(tx, tenantId, siteId, { replacingStoreId: client.siteId });
    } else if (client.siteId) {
      await deactivateStoreLocked(tx, client, client.siteId);
    }
    const [row] = await tx.update(clients).set({ siteId }).where(eq(clients.id, client.id)).returning();
    return row;
  });
}

/**
 * Changes the plan. Refuses a move to Scholarship while the client is over
 * the Scholarship limits. Does not turn locations or ad accounts off.
 */
export async function setClientPlan(tenantId: string, plan: PlanId): Promise<TenantRow> {
  if (!isPlanId(plan)) throw new EntitlementError("This account's plan isn't recognized.");
  return withTenantWriteLock(tenantId, async (tx, client) => {
    if (client.plan === plan) return client;
    if (plan === "scholarship") {
      const activeLocations = await activeStoreIds(tx, tenantId);
      if (activeLocations.length > SCHOLARSHIP_LOCATION_LIMIT) {
        throw new EntitlementError(SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE);
      }
      const accountRows = await tx
        .select({
          platform: adAccounts.platform,
          connectionStatus: adAccounts.connectionStatus,
        })
        .from(adAccounts)
        .where(eq(adAccounts.clientId, tenantId));
      const activeByPlatform: Record<string, number> = {};
      for (const row of accountRows) {
        if (!isActiveAdAccountStatus(row.connectionStatus)) continue;
        activeByPlatform[row.platform] = (activeByPlatform[row.platform] ?? 0) + 1;
      }
      const over = Object.entries(activeByPlatform)
        .filter(([, count]) => count > SCHOLARSHIP_AD_ACCOUNTS_PER_PLATFORM)
        .sort(([left], [right]) => left.localeCompare(right));
      if (over.length > 0) {
        throw new EntitlementError(scholarshipDowngradeAdAccountMessage(over[0][0]));
      }
    }
    const [row] = await tx.update(clients).set({ plan }).where(eq(clients.id, tenantId)).returning();
    return row;
  });
}
