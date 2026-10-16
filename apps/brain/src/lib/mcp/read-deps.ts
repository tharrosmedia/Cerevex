import { neon } from "@neondatabase/serverless";
import { internalKeyMatches } from "../../../lib/sensitive-auth";
import { handleMcpBrainRead, type McpBrainReadDeps } from "./read-handler";
import { loadMcpReadGrant, type Sql } from "./read-grant";
import { loadMcpReadPage } from "./read-rows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function workspaceId(): string | null {
  const value = process.env.ADS_INTERNAL_WORKSPACE_ID?.trim() ?? "";
  return UUID.test(value) ? value : null;
}

function sqlClient(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("read unavailable");
  return neon(databaseUrl) as unknown as Sql;
}

export function mcpBrainReadDeps(): McpBrainReadDeps {
  return {
    keyMatches: (provided) => internalKeyMatches(provided),
    workspaceId,
    async loadGrant(identityId, clientId, scopeWorkspaceId) {
      return loadMcpReadGrant(sqlClient(), identityId, clientId, scopeWorkspaceId);
    },
    async loadPage(input) {
      return loadMcpReadPage(sqlClient(), input);
    },
    log(event) {
      console.info(JSON.stringify(event));
    },
  };
}

export function GET(request: Request): Promise<Response> {
  return handleMcpBrainRead(request, mcpBrainReadDeps());
}
