import {
  decideMcpReadAccess,
  type McpGrantClient,
} from "@cerevex/contracts";

export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export type McpReadGrant =
  | { ok: false }
  | {
      ok: true;
      siteId: string | null;
      workspaceSettings: unknown;
      clientSettings: unknown;
    };

function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  return lower in row ? row[lower] : undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read os.mcp_identity_grants for this identity only.
 * Empty grants fail closed in decideMcpReadAccess. This does not list every client.
 */
export async function loadMcpReadGrant(
  sql: Sql,
  identityId: string,
  clientId: string,
  workspaceId: string,
): Promise<McpReadGrant> {
  const rows = await sql`
    SELECT
      i.scopes AS "scopes",
      i.workspace_id AS "workspaceId",
      w.settings_json AS "workspaceSettings",
      g.client_id AS "clientId",
      c.id AS "clientRowId",
      c.site_id AS "siteId"
    FROM os.mcp_identities i
    JOIN os.workspaces w ON w.id = i.workspace_id
    LEFT JOIN os.mcp_identity_grants g ON g.identity_id = i.id
    LEFT JOIN os.clients c ON c.id = g.client_id AND c.workspace_id = i.workspace_id
    WHERE i.id = ${identityId}
      AND i.workspace_id = ${workspaceId}
      AND i.revoked_at IS NULL
  `;
  const first = rows[0];
  const identity = first
    ? {
        scopes: field(first, "scopes"),
        workspaceId: text(field(first, "workspaceId")) ?? "",
        revoked: false,
      }
    : null;
  const grants: McpGrantClient[] = [];
  for (const row of rows) {
    const grantedId = text(field(row, "clientId"));
    const clientRowId = text(field(row, "clientRowId"));
    if (!grantedId || clientRowId !== grantedId) continue;
    grants.push({ clientId: grantedId, siteId: text(field(row, "siteId")) });
  }
  const decision = decideMcpReadAccess({ workspaceId, identity, grants, clientId });
  if (!decision.ok) return { ok: false };

  let clientSettings: unknown = {};
  if (decision.siteId) {
    const stores = await sql`
      SELECT config
      FROM stores
      WHERE id = ${decision.siteId}::uuid
      LIMIT 1
    `;
    const config = stores[0] ? field(stores[0], "config") : null;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      clientSettings = (config as Record<string, unknown>).workspace ?? {};
    }
  }
  return {
    ok: true,
    siteId: decision.siteId,
    workspaceSettings: first ? (field(first, "workspaceSettings") ?? {}) : {},
    clientSettings,
  };
}
