import "server-only";
import { and, eq } from "drizzle-orm";
import { DEFAULT_APPROVE_OPERATOR_EMAIL } from "@cerevex/contracts";
import type { ClientSkillConfig, SkillConfigBundle } from "@cerevex/skills";
import type { Database } from "./db";
import { clients, memberships, skillClientConfigs, skillStoreConfigs, users } from "./schema";
import { SKILL_CLIENT_ALIASES } from "./skill-client-aliases";
import { assessTestDatabase, type EnvLike } from "./test-database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SkillConfigImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillConfigImportError";
  }
}

/**
 * Skill-config import uses the shared test-database guard (effective host,
 * including `?host=`). It does not keep a separate hostname regex.
 */
export function assertLocalDatabase(connectionString: string, env: EnvLike = process.env): void {
  const verdict = assessTestDatabase({
    databaseUrl: connectionString,
    env,
    purpose: "skill config import",
    requireUrl: true,
  });
  if (!verdict.allowed) throw new SkillConfigImportError(verdict.message);
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
  approvalOwnerUserId: string;
  warnings: string[];
}

function approvalOwnerLabel(client: ClientSkillConfig): string {
  const override = process.env.APPROVAL_OWNER_NAME?.trim();
  if (override && client.approvalOwnerResolved.resolvedFrom !== "profile") return override;
  return client.approvalOwnerResolved.name;
}

function workspaceIdForLinkedClients(
  rows: ReadonlyArray<{ id: string; name: string; workspaceId: string }>,
): string {
  const workspaceIds = new Set<string>();
  for (const slug of Object.keys(SKILL_CLIENT_ALIASES)) {
    const link = resolveSkillClientLink(slug, rows);
    if (!link.clientId) continue;
    const row = rows.find((item) => item.id === link.clientId);
    if (row) workspaceIds.add(row.workspaceId);
  }
  if (workspaceIds.size === 1) return [...workspaceIds][0]!;
  if (workspaceIds.size === 0) {
    throw new SkillConfigImportError(
      "No in-scope os.clients row identifies a workspace. Set APPROVAL_OWNER_USER_ID. Refusing to bind an owner from another workspace.",
    );
  }
  throw new SkillConfigImportError(
    `In-scope clients span ${workspaceIds.size} workspaces. Set APPROVAL_OWNER_USER_ID. Refusing to bind one owner across workspaces.`,
  );
}

/**
 * Bind the approval owner to APPROVAL_OWNER_USER_ID, or to Adam's user when
 * that user is an owner of the workspace that holds the linked clients.
 * Any other owner is refused. Failure throws before a row is written.
 */
async function resolveApprovalOwnerUserId(
  db: Database,
  rows: ReadonlyArray<{ id: string; name: string; workspaceId: string }>,
): Promise<string> {
  const configured = process.env.APPROVAL_OWNER_USER_ID?.trim();
  if (configured) {
    if (!UUID_RE.test(configured)) {
      throw new SkillConfigImportError(
        "APPROVAL_OWNER_USER_ID is not a uuid. Refusing to bind the approval owner.",
      );
    }
    const user = await db.query.users.findFirst({ where: eq(users.id, configured) });
    if (!user) {
      throw new SkillConfigImportError(
        `APPROVAL_OWNER_USER_ID ${configured} does not match os.users.id. Refusing to bind the approval owner.`,
      );
    }
    return user.id;
  }

  const workspaceId = workspaceIdForLinkedClients(rows);
  const email = DEFAULT_APPROVE_OPERATOR_EMAIL.toLowerCase();
  const adam = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!adam) {
    throw new SkillConfigImportError(
      `No os.users row for the Approve operator in packages/contracts/src/approve-allowlist.ts. Set APPROVAL_OWNER_USER_ID. Refusing to bind another workspace owner.`,
    );
  }
  const [membership] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, adam.id),
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.role, "owner"),
      ),
    );
  if (!membership) {
    throw new SkillConfigImportError(
      `The Approve operator is not an owner of workspace ${workspaceId}. Refusing to bind another workspace owner under the agency-owner label. Set APPROVAL_OWNER_USER_ID to bind an explicit user.`,
    );
  }
  return adam.id;
}

/**
 * Upsert the imported bundle into os.skill_client_configs / os.skill_store_configs.
 * Links client_id through SKILL_CLIENT_ALIASES. Does not create os.clients rows
 * and does not insert Level Agency slugs.
 *
 * approval_owner_resolved stores the identity (default "agency owner (Adam Leech)",
 * overridable with APPROVAL_OWNER_NAME). approval_owner_user_id is Adam's user
 * on that workspace, or APPROVAL_OWNER_USER_ID.
 */
export async function importSkillConfigBundle(
  db: Database,
  bundle: SkillConfigBundle,
): Promise<SkillConfigImportResult> {
  const existing = await db.select().from(clients);
  const approvalOwnerUserId = await resolveApprovalOwnerUserId(db, existing);
  const warnings: string[] = [];
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
      approvalOwnerUserId,
      configJson: client,
      missingFactsJson: bundle.missingFacts[client.slug],
    };
    await db.transaction(async (tx) => {
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
          },
        });
      await tx.delete(skillStoreConfigs).where(eq(skillStoreConfigs.clientSlug, client.slug));
      if (client.stores.length > 0) {
        await tx.insert(skillStoreConfigs).values(
          client.stores.map((store) => ({
            clientSlug: client.slug,
            storeKey: store.storeKey,
            brainStoreId: store.brainStoreId,
            role: store.role,
            configJson: store,
          })),
        );
      }
    });
  }

  return { links, approvalOwnerUserId, warnings };
}
