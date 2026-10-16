import { GET as readGet } from "@/src/lib/mcp/read-deps";

export const dynamic = "force-dynamic";

/** GET only. Ads calls this after the MCP grant check. There is no write. */
export function GET(request: Request): Promise<Response> {
  return readGet(request);
}
