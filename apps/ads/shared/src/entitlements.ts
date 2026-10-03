/**
 * Server-side plan checks. The tenant is the OS client id.
 *
 * getEntitlements, assertCanActivateStore, and assertCanActivateAdAccount
 * are the guards. Monthly counters are not stored here.
 */
import {
  adAccountLimitPerPlatform,
  decideAdAccountActivation,
  decideAdAccountActivations,
  decideLocationActivation,
  isActiveAdAccountStatus,
  isPlanId,
  locationLimit,
  monthlyCapsFor,
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
  const [row] = await tx.select().from(clients).where(eq(clients.id, tenantId)).for("update");
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

export async function assertCanActivateStore(
  tenantId: string,
  storeId: string,
  options?: { replacingStoreId?: string | null },
): Promise<void> {
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.id, tenantId) });
  if (!client) throw new EntitlementError("Client not found", 404);
  const active = await activeStoreIds(db, tenantId);
  const decision = decideLocationActivation({
    plan: planOf(client),
    storeId,
    activeStoreIds: active,
    replacingStoreId: options?.replacingStoreId,
  });
  if (!decision.allowed) throw new EntitlementError(decision.message);
}

export async function assertCanActivateAdAccount(
  tenantId: string,
  platform: string,
  externalId: string,
  options?: { replacingExternalId?: string | null },
): Promise<void> {
  await assertCanActivateAdAccounts(tenantId, platform, [externalId], {
    replacingExternalIds: options?.replacingExternalId ? [options.replacingExternalId] : [],
  });
}

/** Rejects the whole set before any account is connected. */
export async function assertCanActivateAdAccounts(
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

export async function activateStore(
  tenantId: string,
  storeId: string,
  options?: { replacingStoreId?: string | null },
): Promise<typeof locations.$inferSelect> {
  const db = getDb();
  return db.transaction(async (tx) => {
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
  });
}

export async function deactivateStore(
  tenantId: string,
  storeId: string,
): Promise<typeof locations.$inferSelect | null> {
  const [row] = await getDb()
    .update(locations)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(and(eq(locations.clientId, tenantId), eq(locations.storeId, storeId)))
    .returning();
  return row ?? null;
}
