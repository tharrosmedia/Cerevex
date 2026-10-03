import { eq } from "drizzle-orm";
import type { ClientSkillConfig, SkillConfigBundle } from "@cerevex/skills";
import type { Database } from "./db";
import { clients, memberships, skillClientConfigs, skillStoreConfigs, users } from "./schema";
import { SKILL_CLIENT_ALIASES } from "./skill-client-aliases";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export interface SkillClientLink {
  clientId: string | null;
  warning: string | null;
}

/**
 * Link a profile slug to os.clients by the alias map.
 * An unknown slug, or a known slug with no matching row, stays unlinked and returns a warning.
 */
export function resolveSkillClientLink(
  slug: string,
  rows: ReadonlyArray<{ id: string; name: string }>,
): SkillClientLink {
  const aliases = SKILL_CLIENT_ALIASES[slug];
  if (!aliases) {
    return {
      clientId: null,
      warning: `Unknown client slug "${slug}" is not in the skill client alias map; leaving client_id unset.`,
    };
  }
  for (const name of aliases) {
    const match = rows.find((row) => row.name === name);
    if (match) return { clientId: match.id, warning: null };
  }
  return {
    clientId: null,
    warning: `No os.clients row for ${slug} (names: ${aliases.join(", ")}); leaving client_id unset.`,
  };
}

export interface SkillConfigImportResult {
  links: Array<{ slug: string; clientId: string | null; warning: string | null }>;
  approvalOwnerUserId: string | null;
  warnings: string[];
}

function approvalOwnerLabel(client: ClientSkillConfig): string {
  const override = process.env.APPROVAL_OWNER_NAME?.trim();
  if (override && client.approvalOwnerResolved.resolvedFrom !== "profile") return override;
  return client.approvalOwnerResolved.name;
}

async function resolveApprovalOwnerUserId(
  db: Database,
): Promise<{ userId: string | null; warning: string | null }> {
  const configured = process.env.APPROVAL_OWNER_USER_ID?.trim();
  if (configured) {
    if (!UUID_RE.test(configured)) {
      return {
        userId: null,
        warning: "APPROVAL_OWNER_USER_ID is not a uuid; leaving approval_owner_user_id unset.",
      };
    }
    const user = await db.query.users.findFirst({ where: eq(users.id, configured) });
    if (!user) {
      return {
        userId: null,
        warning: `APPROVAL_OWNER_USER_ID ${configured} does not match os.users.id; leaving approval_owner_user_id unset.`,
      };
    }
    return { userId: user.id, warning: null };
  }

  const owners = await db.select().from(memberships).where(eq(memberships.role, "owner"));
  if (owners.length === 1) return { userId: owners[0]?.userId ?? null, warning: null };
  if (owners.length === 0) {
    return {
      userId: null,
      warning:
        "No workspace membership with role owner; set APPROVAL_OWNER_USER_ID to bind the approval owner. Leaving approval_owner_user_id unset.",
    };
  }
  return {
    userId: null,
    warning:
      "More than one workspace owner membership; set APPROVAL_OWNER_USER_ID to bind the approval owner. Leaving approval_owner_user_id unset.",
  };
}

/**
 * Upsert the imported bundle into os.skill_client_configs / os.skill_store_configs.
 * Links client_id through SKILL_CLIENT_ALIASES. Does not create os.clients rows
 * and does not insert Level Agency slugs.
 *
 * approval_owner_resolved stores the identity (default "agency owner (Adam Leech)",
 * overridable with APPROVAL_OWNER_NAME). approval_owner_user_id binds that identity
 * to os.users via APPROVAL_OWNER_USER_ID, or the single workspace owner membership.
 */
export async function importSkillConfigBundle(
  db: Database,
  bundle: SkillConfigBundle,
): Promise<SkillConfigImportResult> {
  const existing = await db.select().from(clients);
  const owner = await resolveApprovalOwnerUserId(db);
  const warnings: string[] = [];
  if (owner.warning) {
    warnings.push(owner.warning);
    console.warn(owner.warning);
  }
  const links: SkillConfigImportResult["links"] = [];

  for (const client of bundle.clients) {
    if (!client.scopeAllowed) {
      throw new Error(`Refusing to store out-of-scope client ${client.slug}`);
    }
    const linked = resolveSkillClientLink(client.slug, existing);
    if (linked.warning) {
      warnings.push(linked.warning);
      console.warn(linked.warning);
    }
    links.push({ slug: client.slug, clientId: linked.clientId, warning: linked.warning });
    const label = approvalOwnerLabel(client);
    const values = {
      slug: client.slug,
      clientId: linked.clientId,
      displayName: client.displayName,
      snapshotId: client.snapshotId,
      profileHash: client.profileHash,
      marketingGate: client.marketingGate,
      scopeAllowed: true,
      pilot: client.pilot,
      approvalOwnerResolved: label,
      approvalOwnerUserId: owner.userId,
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
          approvalOwnerUserId: values.approvalOwnerUserId,
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

  return { links, approvalOwnerUserId: owner.userId, warnings };
}
