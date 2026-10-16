/** Phase-1 Cerevex MCP scopes. No apply, approve, publish, or spend scope exists. */
export const MCP_SCOPES = ["cerevex.read", "cerevex.recs.submit"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/** Phase-1 reads. get_ga4_report stays out until GA4 slice 2. */
export const MCP_READ_TOOLS = ["get_gsc_performance", "get_seo_findings", "get_store_catalog"] as const;

export type McpReadTool = (typeof MCP_READ_TOOLS)[number];

export function isMcpReadTool(value: string): value is McpReadTool {
  return (MCP_READ_TOOLS as readonly string[]).includes(value);
}

/** Brief §11 caps a read at 1,000 rows. Phase 1 stays at this lower cap. */
export const MCP_READ_DEFAULT_LIMIT = 50;
export const MCP_READ_MAX_LIMIT = 100;
/** Search Console sync window in the connector brief. Inclusive. */
export const MCP_GSC_MAX_RANGE_DAYS = 28;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function mcpUtcDay(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms;
}

/** Inclusive day count, or null when the range is reversed, invalid, or over the cap. */
export function mcpInclusiveDays(start: string, end: string): number | null {
  const from = mcpUtcDay(start);
  const to = mcpUtcDay(end);
  if (from == null || to == null || to < from) return null;
  const days = Math.round((to - from) / DAY_MS) + 1;
  if (days < 1 || days > MCP_GSC_MAX_RANGE_DAYS) return null;
  return days;
}

export function mcpDefaultGscRange(nowMs: number): { dateStart: string; dateEnd: string } {
  const now = new Date(nowMs);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (MCP_GSC_MAX_RANGE_DAYS - 1) * DAY_MS;
  return { dateStart: new Date(start).toISOString().slice(0, 10), dateEnd: new Date(end).toISOString().slice(0, 10) };
}

/** Undefined uses the default. Any other out-of-range value is refused. */
export function mcpReadLimit(value: unknown): number | null {
  if (value === undefined) return MCP_READ_DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MCP_READ_MAX_LIMIT) return null;
  return value;
}
