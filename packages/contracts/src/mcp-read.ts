import {
  isGscRecommendationsVisible,
  resolveWorkspaceCapabilities,
  type ProcessEnvMap,
} from "./capabilities";
import {
  MCP_READ_MAX_LIMIT,
  isMcpReadTool,
  isMcpScope,
  type McpReadTool,
} from "./mcp";

/**
 * Ads calls this Brain route after it has resolved the MCP identity.
 * Brain checks os.mcp_identity_grants again. GET only.
 * A dedicated Brain key is a follow-up. This caller marker is not a secret.
 */
export const MCP_BRAIN_READ_PATH = "/api/internal/mcp/read";
export const MCP_BRAIN_READ_CALLER = "ads-mcp-read";
export const MCP_BRAIN_READ_CALLER_HEADER = "x-cerevex-caller";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const KIND = /^[a-z0-9_]{1,32}$/;
const HANDLE = /^[A-Za-z0-9._-]{1,80}$/;
const FINDING_STATUS = new Set(["open", "queued", "dismissed", "snoozed", "denied"]);
const SEVERITY = new Set(["high", "med", "low", "info"]);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CURSOR = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_OFFSET = 100_000;

export type McpReadLogEvent = {
  msg: "mcp.read";
  identityId: string;
  clientId: string;
  tool: McpReadTool;
  rows: number;
};

/** Identity, client, tool, and row count. No payload and no secret. */
export function mcpReadLogEvent(input: {
  identityId: string;
  clientId: string;
  tool: McpReadTool;
  rows: number;
}): McpReadLogEvent {
  return {
    msg: "mcp.read",
    identityId: input.identityId,
    clientId: input.clientId,
    tool: input.tool,
    rows: input.rows,
  };
}

export type McpGscQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type McpGscPageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type McpFindingReadRow = {
  id: string;
  kind: string;
  severity: "high" | "med" | "low" | "info";
  title: string;
  status: "open" | "queued" | "dismissed" | "snoozed" | "denied";
  handle: string | null;
};

export type McpCatalogReadRow = {
  handle: string;
  title: string;
};

export type McpBrainRead = {
  clientId: string;
  storeId: string | null;
  lastSyncedAt: string | null;
  sourceSystem: "brain";
  availability: "ready";
  limit: number;
  nextCursor: string | null;
  returned: number;
  dateStart?: string;
  dateEnd?: string;
  view?: "queries" | "pages" | "both";
  queries?: McpGscQueryRow[];
  pages?: McpGscPageRow[];
  status?: "open" | "all";
  findings?: McpFindingReadRow[];
  products?: McpCatalogReadRow[];
  collections?: McpCatalogReadRow[];
};

export type McpReadCursor =
  | { tool: "get_gsc_performance"; side: "queries" | "pages"; offset: number }
  | { tool: "get_seo_findings"; offset: number }
  | { tool: "get_store_catalog"; side: "products" | "collections"; offset: number };

type GrantIdentity = {
  scopes: unknown;
  workspaceId: string;
  revoked: boolean;
};

export type McpGrantClient = {
  clientId: string;
  siteId: string | null;
};

/**
 * Fail closed. An empty grant list is not "all clients".
 * The caller only receives the one requested client, and only when it is granted.
 */
export function decideMcpReadAccess(input: {
  workspaceId: string | null;
  identity: GrantIdentity | null;
  grants: readonly McpGrantClient[];
  clientId: string;
}): { ok: true; siteId: string | null } | { ok: false } {
  if (!input.workspaceId || !UUID.test(input.workspaceId)) return { ok: false };
  const identity = input.identity;
  if (!identity || identity.revoked) return { ok: false };
  if (identity.workspaceId !== input.workspaceId) return { ok: false };
  if (!readScopes(identity.scopes).includes("cerevex.read")) return { ok: false };
  if (input.grants.length === 0) return { ok: false };
  const match = input.grants.find((grant) => grant.clientId === input.clientId);
  if (!match) return { ok: false };
  return { ok: true, siteId: siteIdOf(match.siteId) };
}

function readScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && isMcpScope(item) && !scopes.includes(item)) scopes.push(item);
  }
  return scopes;
}

function siteIdOf(value: string | null): string | null {
  if (!value || !UUID.test(value)) return null;
  return value;
}

/**
 * Search performance and Search findings follow seo.gsc.recommendations.
 * Hidden on the workspace or on the client returns nothing for that module.
 * seo.gsc.apply does not gate a read.
 */
export function mcpGscReadVisible(
  workspaceSettings: unknown,
  clientSettings: unknown,
  env?: ProcessEnvMap,
): boolean {
  const workspace = resolveWorkspaceCapabilities(workspaceSettings, env);
  const client = resolveWorkspaceCapabilities(clientSettings, env);
  return isGscRecommendationsVisible(workspace) && isGscRecommendationsVisible(client);
}

/** Null cursor starts the first page. Anything else must be a structured cursor for that tool. */
export function mcpReadCursor(tool: McpReadTool, cursor: string | null): McpReadCursor | null {
  if (cursor == null) {
    if (tool === "get_gsc_performance") return { tool, side: "queries", offset: 0 };
    if (tool === "get_seo_findings") return { tool, offset: 0 };
    return { tool, side: "products", offset: 0 };
  }
  if (!CURSOR.test(cursor)) return null;
  const match = /^(gq|gp|f|cp|cc)(\d{1,6})$/.exec(cursor);
  if (!match) return null;
  const offset = Number(match[2]);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return null;
  const prefix = match[1];
  if (tool === "get_gsc_performance" && (prefix === "gq" || prefix === "gp")) {
    return { tool, side: prefix === "gq" ? "queries" : "pages", offset };
  }
  if (tool === "get_seo_findings" && prefix === "f") return { tool, offset };
  if (tool === "get_store_catalog" && (prefix === "cp" || prefix === "cc")) {
    return { tool, side: prefix === "cp" ? "products" : "collections", offset };
  }
  return null;
}

export function mcpReadCursorToken(cursor: McpReadCursor): string {
  if (cursor.tool === "get_gsc_performance") return `${cursor.side === "queries" ? "gq" : "gp"}${cursor.offset}`;
  if (cursor.tool === "get_seo_findings") return `f${cursor.offset}`;
  return `${cursor.side === "products" ? "cp" : "cc"}${cursor.offset}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unsafeText(value: string): boolean {
  return EMAIL.test(value) || PHONE.test(value);
}

function plain(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || unsafeText(trimmed)) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function pageUrl(value: unknown): string | null {
  const text = plain(value, 300);
  if (!text || !/^https:\/\/[^\s]+$/.test(text)) return null;
  return text;
}

function whole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) return null;
  return value;
}

function metric(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return null;
  return Math.round(value * 1000) / 1000;
}

function gscQuery(value: unknown): McpGscQueryRow | null {
  if (!isRecord(value)) return null;
  const query = plain(value.query, 200);
  const clicks = whole(value.clicks);
  const impressions = whole(value.impressions);
  const ctr = metric(value.ctr, 1);
  const position = metric(value.position, 1000);
  if (!query || clicks == null || impressions == null || ctr == null || position == null) return null;
  return { query, clicks, impressions, ctr, position };
}

function gscPage(value: unknown): McpGscPageRow | null {
  if (!isRecord(value)) return null;
  const page = pageUrl(value.page);
  const clicks = whole(value.clicks);
  const impressions = whole(value.impressions);
  const ctr = metric(value.ctr, 1);
  const position = metric(value.position, 1000);
  if (!page || clicks == null || impressions == null || ctr == null || position == null) return null;
  return { page, clicks, impressions, ctr, position };
}

function findingRow(value: unknown): McpFindingReadRow | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && UUID.test(value.id) ? value.id : null;
  const kind = typeof value.kind === "string" && KIND.test(value.kind) ? value.kind : null;
  const severity = typeof value.severity === "string" && SEVERITY.has(value.severity) ? value.severity : null;
  const title = plain(value.title, 200);
  const status = typeof value.status === "string" && FINDING_STATUS.has(value.status) ? value.status : null;
  const handle = value.handle == null ? null : typeof value.handle === "string" && HANDLE.test(value.handle) ? value.handle : undefined;
  if (!id || !kind || !severity || !title || !status || handle === undefined) return null;
  return { id, kind, severity: severity as McpFindingReadRow["severity"], title, status: status as McpFindingReadRow["status"], handle };
}

function catalogRow(value: unknown): McpCatalogReadRow | null {
  if (!isRecord(value)) return null;
  const handle = typeof value.handle === "string" && HANDLE.test(value.handle) ? value.handle : null;
  const title = plain(value.title, 200);
  if (!handle || !title) return null;
  return { handle, title };
}

function takeBudget<T>(value: unknown, budget: { left: number }, project: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > MCP_READ_MAX_LIMIT) return null;
  const rows: T[] = [];
  for (const row of value) {
    if (budget.left <= 0) break;
    const projected = project(row);
    if (!projected) continue;
    rows.push(projected);
    budget.left -= 1;
  }
  return rows;
}

function syncedAt(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !ISO_TIME.test(value)) return null;
  return value;
}

function responseCursor(value: unknown, returned: number, limit: number): string | null {
  if (returned < limit || value == null) return null;
  if (typeof value !== "string" || !CURSOR.test(value)) return null;
  if (!/^(gq|gp|f|cp|cc)\d{1,6}$/.test(value)) return null;
  return value;
}

export type McpBrainReadRequest = {
  tool: McpReadTool;
  clientId: string;
  limit: number;
  dateStart?: string;
  dateEnd?: string;
  view?: "queries" | "pages" | "both";
  status?: "open" | "all";
};

/**
 * Copy only the fields a read may return. Emails, phones, and anything
 * outside that field list are dropped here, before the bytes leave Brain.
 */
export function projectMcpBrainRead(request: McpBrainReadRequest, read: unknown): McpBrainRead | null {
  if (!isRecord(read)) return null;
  if (!isMcpReadTool(request.tool)) return null;
  if (read.clientId !== request.clientId || !UUID.test(request.clientId)) return null;
  if (read.sourceSystem !== "brain" || read.availability !== "ready") return null;
  if (read.limit !== request.limit) return null;
  const storeId = read.storeId == null ? null : typeof read.storeId === "string" && UUID.test(read.storeId) ? read.storeId : undefined;
  if (storeId === undefined) return null;
  const lastSyncedAt = syncedAt(read.lastSyncedAt);
  if (read.lastSyncedAt != null && lastSyncedAt == null) return null;

  const payload: McpBrainRead = {
    clientId: request.clientId,
    storeId,
    lastSyncedAt,
    sourceSystem: "brain",
    availability: "ready",
    limit: request.limit,
    nextCursor: null,
    returned: 0,
  };
  const budget = { left: request.limit };

  if (request.tool === "get_gsc_performance") {
    const view = request.view ?? "both";
    const queries = view === "pages" ? [] : takeBudget(read.queries, budget, gscQuery);
    const pages = view === "queries" ? [] : takeBudget(read.pages, budget, gscPage);
    if (!queries || !pages) return null;
    const returned = queries.length + pages.length;
    payload.dateStart = request.dateStart;
    payload.dateEnd = request.dateEnd;
    payload.view = view;
    if (view !== "pages") payload.queries = queries;
    if (view !== "queries") payload.pages = pages;
    payload.returned = returned;
    payload.nextCursor = responseCursor(read.nextCursor, returned, request.limit);
    return payload;
  }

  if (request.tool === "get_seo_findings") {
    const findings = takeBudget(read.findings, budget, findingRow);
    if (!findings) return null;
    payload.status = request.status ?? "open";
    payload.findings = findings;
    payload.returned = findings.length;
    payload.nextCursor = responseCursor(read.nextCursor, findings.length, request.limit);
    return payload;
  }

  const products = takeBudget(read.products, budget, catalogRow);
  const collections = takeBudget(read.collections, budget, catalogRow);
  if (!products || !collections) return null;
  const returned = products.length + collections.length;
  payload.products = products;
  payload.collections = collections;
  payload.returned = returned;
  payload.nextCursor = responseCursor(read.nextCursor, returned, request.limit);
  return payload;
}
