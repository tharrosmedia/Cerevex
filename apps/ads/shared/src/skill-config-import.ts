import { eq } from "drizzle-orm";
import type { SkillConfigBundle } from "@cerevex/skills";
import type { Database } from "./db";
import { clients, skillClientConfigs, skillStoreConfigs } from "./schema";

/** Profile import writes config only. It does not run against Neon or any other remote host. */
export function assertLocalDatabase(connectionString: string): void {
  const host = /@([^/:?]+)/.exec(connectionString)?.[1] ?? "";
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "postgres" ||
    host.endsWith(".local");
  if (!local) {
    throw new Error(
      `Refusing to write skill config to non-local database host "${host}". Prod migrations and imports run only after Adam merges and Cos confirms.`,
    );
  }
}

/**
 * Upsert the imported bundle into os.skill_client_configs / os.skill_store_configs.
 * Links client_id only when os.clients.name equals the profile display name.
 * Does not create os.clients rows and does not insert Level Agency slugs.
 */
export async function importSkillConfigBundle(db: Database, bundle: SkillConfigBundle): Promise<void> {
  const existing = await db.select().from(clients);
  for (const client of bundle.clients) {
    if (!client.scopeAllowed) {
      throw new Error(`Refusing to store out-of-scope client ${client.slug}`);
    }
    const linked = existing.find((row) => row.name === client.displayName);
    const values = {
      slug: client.slug,
      clientId: linked?.id ?? null,
      displayName: client.displayName,
      snapshotId: client.snapshotId,
      profileHash: client.profileHash,
      marketingGate: client.marketingGate,
      scopeAllowed: true,
      pilot: client.pilot,
      approvalOwnerResolved: client.approvalOwnerResolved.name,
      configJson: client,
      missingFactsJson: bundle.missingFacts[client.slug],
    };
    await db
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
          configJson: values.configJson,
          missingFactsJson: values.missingFactsJson,
        },
      });
    await db.delete(skillStoreConfigs).where(eq(skillStoreConfigs.clientSlug, client.slug));
    if (client.stores.length > 0) {
      await db.insert(skillStoreConfigs).values(
        client.stores.map((store) => ({
          clientSlug: client.slug,
          storeKey: store.storeKey,
          brainStoreId: store.brainStoreId,
          role: store.role,
          configJson: store,
        })),
      );
    }
  }
}
