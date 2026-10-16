import { timingSafeEqual } from "node:crypto";
import { isProductionRuntime } from "@cerevex/contracts";
import { internalWorkspaceId } from "./auth";

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * MCP_SERVICE_KEY is the cerevex-mcp principal. It is not ADS_INTERNAL_KEY.
 * A copy of the Brain key is refused so that secret cannot open the connector routes
 * and the connector secret cannot be replayed as the Brain service key.
 */
export function mcpKeyMatches(provided: string | undefined | null): boolean {
  const expected = process.env.MCP_SERVICE_KEY;
  if (!expected || !provided) return false;
  if (expected.trim() !== expected || provided.trim() !== provided) return false;
  const internal = process.env.ADS_INTERNAL_KEY;
  if (internal && sameSecret(expected, internal)) return false;
  return sameSecret(provided, expected);
}

export function assertMcpPrincipalConfigured(): void {
  if (!isProductionRuntime()) return;
  const mcp = process.env.MCP_SERVICE_KEY?.trim() ?? "";
  const internal = process.env.ADS_INTERNAL_KEY?.trim() ?? "";
  if (mcp && internal && mcp === internal) {
    throw new Error("MCP_SERVICE_KEY must not equal ADS_INTERNAL_KEY");
  }
  if (mcp && !internalWorkspaceId()) {
    throw new Error("ADS_INTERNAL_WORKSPACE_ID must be set when MCP_SERVICE_KEY is set");
  }
}
