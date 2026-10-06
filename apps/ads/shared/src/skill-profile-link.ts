/**
 * One-slug skill profile upsert shared with the CLI bundle import.
 * The CLI (`importSkillConfigBundle`) writes every in-scope slug and links
 * client_id through the alias map. A profile load writes one slug onto the
 * client the owner named, and sets brain_store_id from that client's site
 * for web and service-area store keys.
 */
import type { ClientSkillConfig, SkillConfigBundle, StoreSkillConfig } from "@cerevex/skills";
import { eq, sql } from "drizzle-orm";
import { resolveAuditActor } from "./actor";
import type { Database } from "./db";
import { auditLog, skillClientConfigs, skillStoreConfigs } from "./schema";

type SkillTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type SkillProfileLinkCode = "unknown_slug" | "already_linked" | "no_site";

export class SkillProfileLinkError extends Error {
  readonly code: SkillProfileLinkCode;

  constructor(code: SkillProfileLinkCode, message: string) {
    super(message);
    this.name = "SkillProfileLinkError";
    this.code = code;
  }
}

export function approvalOwnerLabel(client: ClientSkillConfig): string {
  const override = process.env.APPROVAL_OWNER_NAME?.trim();
  if (override && client.approvalOwnerResolved.resolvedFrom !== "profile") return override;
  return client.approvalOwnerResolved.name;
}

/** CLI import keeps the snapshot's brain store id (null until a profile load). */
export function importedStoreBrainId(store: StoreSkillConfig): string | null {
  return store.brainStoreId;
}

/**
 * Profile load: this client's site is the brain store for a web or
 * service-area key. Storefront and product keys keep the snapshot id.
 */
export function linkedStoreBrainId(siteId: string, store: StoreSkillConfig): string | null {
  if (store.role === "web" || store.role === "service-area") return siteId;
  return store.brainStoreId;
}

export type SkillStoreWrite = {
  clientSlug: string;
  storeKey: string;
  brainStoreId: string | null;
  role: string;
  configJson: StoreSkillConfig;
};

export function skillStoreRows(
  client: ClientSkillConfig,
  brainStoreIdFor: (store: StoreSkillConfig) => string | null,
): SkillStoreWrite[] {
  return client.stores.map((store) => {
    const brainStoreId = brainStoreIdFor(store);
    const configJson: StoreSkillConfig =
      brainStoreId === store.brainStoreId ? store : { ...store, brainStoreId };
    return {
      clientSlug: client.slug,
      storeKey: store.storeKey,
      brainStoreId,
      role: store.role,
      configJson,
    };
  });
}

export async function upsertSkillClientConfig(
  tx: SkillTx,
  input: {
    client: ClientSkillConfig;
    clientId: string | null;
    approvalOwnerUserId: string;
    approvalOwnerResolved: string;
    missingFacts: unknown;
    stores: SkillStoreWrite[];
    importedAt: Date;
  },
): Promise<void> {
  const values = {
    slug: input.client.slug,
    clientId: input.clientId,
    displayName: input.client.displayName,
    snapshotId: input.client.snapshotId,
    profileHash: input.client.profileHash,
    marketingGate: input.client.marketingGate,
    scopeAllowed: true,
    pilot: input.client.pilot,
    approvalOwnerResolved: input.approvalOwnerResolved,
    approvalOwnerUserId: input.approvalOwnerUserId,
    configJson: input.client,
    missingFactsJson: input.missingFacts ?? [],
    importedAt: input.importedAt,
  };
  await tx
    .insert(skillClientConfigs)
    .values(values)
    .onConflictDoUpdate({
      target: skillClientConfigs.slug,
      set: {
        clientId: values.clientId,
        displayName: values.displayName,
        snapshotId: values.snapshotId,
        profileHash: values.profileHash,
        marketingGate: values.marketingGate,
        scopeAllowed: values.scopeAllowed,
        pilot: values.pilot,
        approvalOwnerResolved: values.approvalOwnerResolved,
        approvalOwnerUserId: values.approvalOwnerUserId,
        configJson: values.configJson,
        missingFactsJson: values.missingFactsJson,
        importedAt: values.importedAt,
      },
    });
  await tx.delete(skillStoreConfigs).where(eq(skillStoreConfigs.clientSlug, input.client.slug));
  if (input.stores.length > 0) {
    await tx.insert(skillStoreConfigs).values(input.stores);
  }
}

export interface SkillProfileLinkResult {
  slug: string;
  clientId: string;
  snapshotId: string;
  stores: Array<{ storeKey: string; role: string; brainStoreId: string | null }>;
}

/**
 * Upsert one bundled slug onto this client. Refuses before any write when
 * the slug is unknown, the client has no site, or the slug is already
 * linked to a different client. A second load of the same client is the
 * same upsert.
 */
export async function linkSkillProfile(
  db: Database,
  bundle: SkillConfigBundle,
  input: {
    slug: string;
    clientId: string;
    siteId: string | null;
    approvalOwnerUserId: string;
    audit: {
      workspaceId: string;
      actorType: string;
      actorId: string | null;
    };
  },
): Promise<SkillProfileLinkResult> {
  const profile = bundle.clients.find((client) => client.slug === input.slug);
  if (!profile || !profile.scopeAllowed) {
    throw new SkillProfileLinkError("unknown_slug", `Unknown skills profile "${input.slug}".`);
  }
  const siteId = input.siteId?.trim() ?? "";
  if (!siteId) {
    throw new SkillProfileLinkError("no_site", "This client has no site. Nothing was saved.");
  }

  const importedAt = new Date();
  const stores = skillStoreRows(profile, (store) => linkedStoreBrainId(siteId, store));
  const actor = resolveAuditActor(input.audit.actorType, input.audit.actorId);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('os.skill_profile'), hashtext(${input.slug}::text))`,
    );
    const [existing] = await tx
      .select({ clientId: skillClientConfigs.clientId })
      .from(skillClientConfigs)
      .where(eq(skillClientConfigs.slug, profile.slug));
    if (existing?.clientId && existing.clientId !== input.clientId) {
      throw new SkillProfileLinkError(
        "already_linked",
        `Skills profile "${profile.slug}" is already linked to another client.`,
      );
    }
    await upsertSkillClientConfig(tx, {
      client: profile,
      clientId: input.clientId,
      approvalOwnerUserId: input.approvalOwnerUserId,
      approvalOwnerResolved: approvalOwnerLabel(profile),
      missingFacts: bundle.missingFacts[profile.slug],
      stores,
      importedAt,
    });
    await tx.insert(auditLog).values({
      workspaceId: input.audit.workspaceId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "skills.profile_loaded",
      entityType: "client",
      entityId: input.clientId,
      payloadJson: {
        slug: profile.slug,
        snapshotId: profile.snapshotId,
        clientId: input.clientId,
        brainStoreId: siteId,
        storeKeys: stores.map((store) => store.storeKey),
      },
    });
    return {
      slug: profile.slug,
      clientId: input.clientId,
      snapshotId: profile.snapshotId,
      stores: stores.map((store) => ({
        storeKey: store.storeKey,
        role: store.role,
        brainStoreId: store.brainStoreId,
      })),
    };
  });
}
