/** Phase-1 Cerevex MCP scopes. No apply, approve, publish, or spend scope exists. */
export const MCP_SCOPES = ["cerevex.read", "cerevex.recs.submit"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}
