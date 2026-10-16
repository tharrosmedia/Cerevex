import { isMcpReadTool, type McpScope } from "@cerevex/contracts";

const SUBMIT_TOOLS = new Set(["validate_recommendation", "submit_recommendation"]);

/** Read tools and ping need cerevex.read. Queue tools need cerevex.recs.submit. */
export function requiredScope(method: string, tool: string | null): McpScope | null {
  if (method === "tools/list") return "cerevex.read";
  if (method !== "tools/call") return null;
  if (tool === "ping" || (tool != null && isMcpReadTool(tool))) return "cerevex.read";
  if (tool && SUBMIT_TOOLS.has(tool)) return "cerevex.recs.submit";
  return null;
}
