import { createHash } from "node:crypto";
import { isMcpScope, type McpScope } from "@cerevex/contracts";

/** SHA-256 hex of the exact UTF-8 token, including the cxm_ prefix. Same rule as the ads API. */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN = /^cxm_[A-Za-z0-9_-]{43}$/;

/** The only credential /mcp accepts. Anything else is absent. */
export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
  const token = match?.[1];
  if (!token || !TOKEN.test(token)) return null;
  return token;
}

export function knownScopes(values: readonly string[]): McpScope[] {
  const scopes: McpScope[] = [];
  for (const value of values) {
    if (isMcpScope(value) && !scopes.includes(value)) scopes.push(value);
  }
  return scopes;
}
