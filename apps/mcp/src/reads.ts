import {
  MCP_READ_DEFAULT_LIMIT,
  MCP_READ_MAX_LIMIT,
  isMcpReadTool,
  mcpDefaultGscRange,
  mcpInclusiveDays,
  mcpReadLimit,
  type McpReadTool,
} from "@cerevex/contracts";
import type { AuditReason, AuditResult } from "./audit";
import type { McpReadRequest, McpReadResponse } from "./guards";
import { pingToolDefinition } from "./ping";
import { PROTOCOL_2026 } from "./protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,80}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const KIND = /^[a-z0-9_]{1,32}$/;
const HANDLE = /^[A-Za-z0-9._-]{1,80}$/;
const FINDING_STATUS = new Set(["open", "queued", "dismissed", "snoozed", "denied"]);
const SEVERITY = new Set(["high", "med", "low", "info"]);

const GSC_KEYS = new Set(["clientId", "dateStart", "dateEnd", "limit", "cursor", "view"]);
const FINDING_KEYS = new Set(["clientId", "limit", "cursor", "status"]);
const CATALOG_KEYS = new Set(["clientId", "limit", "cursor"]);

export type ReadOutcome =
  | { ok: true; result: Record<string, unknown> }
  | {
      ok: false;
      status: 400 | 403 | 404 | 500;
      reason: AuditReason;
      result: AuditResult;
      message: string;
      scope?: string;
    };

function fail(
  status: 400 | 403 | 404 | 500,
  reason: AuditReason,
  result: AuditResult,
  message: string,
  scope?: string,
): ReadOutcome {
  return scope
    ? { ok: false, status, reason, result, message, scope }
    : { ok: false, status, reason, result, message };
}

type ParsedRead = {
  tool: McpReadTool;
  clientId: string;
  limit: number;
  cursor: string | null;
  dateStart?: string;
  dateEnd?: string;
  view?: "queries" | "pages" | "both";
  status?: "open" | "all";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keysAllowed(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function clientIdOf(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function cursorOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !CURSOR.test(value)) return undefined;
  return value;
}

function viewOf(value: unknown): "queries" | "pages" | "both" | null {
  if (value === undefined) return "both";
  if (value === "queries" || value === "pages" || value === "both") return value;
  return null;
}

function statusOf(value: unknown): "open" | "all" | null {
  if (value === undefined) return "open";
  if (value === "open" || value === "all") return value;
  return null;
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

function gscRow(value: unknown, field: "query" | "page"): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const label = field === "query" ? plain(value.query, 200) : pageUrl(value.page);
  if (!label) return null;
  const clicks = whole(value.clicks);
  const impressions = whole(value.impressions);
  const ctr = metric(value.ctr, 1);
  const position = metric(value.position, 1000);
  if (clicks == null || impressions == null || ctr == null || position == null) return null;
  return { [field]: label, clicks, impressions, ctr, position };
}

function findingRow(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const id = clientIdOf(value.id);
  const kind = typeof value.kind === "string" && KIND.test(value.kind) ? value.kind : null;
  const severity = typeof value.severity === "string" && SEVERITY.has(value.severity) ? value.severity : null;
  const title = plain(value.title, 200);
  const status = typeof value.status === "string" && FINDING_STATUS.has(value.status) ? value.status : null;
  const handle = value.handle == null ? null : typeof value.handle === "string" && HANDLE.test(value.handle) ? value.handle : undefined;
  if (!id || !kind || !severity || !title || !status || handle === undefined) return null;
  return { id, kind, severity, title, status, handle };
}

function catalogRow(value: unknown): Record<string, unknown> | null {
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

function storeIdOf(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * Copy only the fields a read may return. Client id must be the one we asked
 * for. Search text that looks like an email or phone is dropped.
 */
function projectRead(tool: McpReadTool, read: Record<string, unknown>, request: ParsedRead): Record<string, unknown> | null {
  if (read.clientId !== request.clientId) return null;
  if (read.sourceSystem !== "stub" || read.availability !== "not_synced") return null;
  if (read.limit !== request.limit) return null;
  const storeId = storeIdOf(read.storeId);
  if (read.storeId != null && storeId == null) return null;
  const nextCursor = read.nextCursor == null ? null : typeof read.nextCursor === "string" && CURSOR.test(read.nextCursor) ? read.nextCursor : undefined;
  if (nextCursor === undefined) return null;

  const payload: Record<string, unknown> = {
    clientId: request.clientId,
    storeId,
    lastSyncedAt: null,
    sourceSystem: "stub",
    availability: "not_synced",
    limit: request.limit,
    nextCursor: null,
  };

  const budget = { left: request.limit };
  if (tool === "get_gsc_performance") {
    const view = request.view ?? "both";
    const queries = view === "pages" ? [] : takeBudget(read.queries, budget, (row) => gscRow(row, "query"));
    const pages = view === "queries" ? [] : takeBudget(read.pages, budget, (row) => gscRow(row, "page"));
    if (!queries || !pages) return null;
    const returned = queries.length + pages.length;
    payload.dateStart = request.dateStart;
    payload.dateEnd = request.dateEnd;
    payload.view = view;
    if (view !== "pages") payload.queries = queries;
    if (view !== "queries") payload.pages = pages;
    payload.returned = returned;
    payload.nextCursor = returned >= request.limit ? nextCursor : null;
    return payload;
  }

  if (tool === "get_seo_findings") {
    const findings = takeBudget(read.findings, budget, findingRow);
    if (!findings) return null;
    payload.status = request.status ?? "open";
    payload.findings = findings;
    payload.returned = findings.length;
    payload.nextCursor = findings.length >= request.limit ? nextCursor : null;
    return payload;
  }

  const products = takeBudget(read.products, budget, catalogRow);
  const collections = takeBudget(read.collections, budget, catalogRow);
  if (!products || !collections) return null;
  const returned = products.length + collections.length;
  payload.products = products;
  payload.collections = collections;
  payload.returned = returned;
  payload.nextCursor = returned >= request.limit ? nextCursor : null;
  return payload;
}

function toolResult(protocolVersion: string, payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: false,
  };
  if (protocolVersion === PROTOCOL_2026) {
    result._meta = { "io.modelcontextprotocol/protocolVersion": protocolVersion };
  }
  return result;
}

function readTool(name: McpReadTool, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  };
}

const clientIdSchema = { type: "string", format: "uuid" };
const limitSchema = { type: "integer", minimum: 1, maximum: MCP_READ_MAX_LIMIT };
const cursorSchema = { type: "string", minLength: 1, maxLength: 80 };
const dateSchema = { type: "string", format: "date" };

export function readToolDefinitions() {
  return [
    readTool(
      "get_gsc_performance",
      "Read-only Search Console queries and pages for one granted client.",
      {
        clientId: clientIdSchema,
        dateStart: dateSchema,
        dateEnd: dateSchema,
        limit: { ...limitSchema, default: MCP_READ_DEFAULT_LIMIT },
        cursor: cursorSchema,
        view: { type: "string", enum: ["queries", "pages", "both"], default: "both" },
      },
      ["clientId"],
    ),
    readTool(
      "get_seo_findings",
      "Read-only SEO findings for one granted client.",
      {
        clientId: clientIdSchema,
        limit: { ...limitSchema, default: MCP_READ_DEFAULT_LIMIT },
        cursor: cursorSchema,
        status: { type: "string", enum: ["open", "all"], default: "open" },
      },
      ["clientId"],
    ),
    readTool(
      "get_store_catalog",
      "Read-only product and collection summary for one granted client.",
      {
        clientId: clientIdSchema,
        limit: { ...limitSchema, default: MCP_READ_DEFAULT_LIMIT },
        cursor: cursorSchema,
      },
      ["clientId"],
    ),
  ];
}

export function phase1ToolsList(protocolVersion: string): Record<string, unknown> {
  const result: Record<string, unknown> = { tools: [pingToolDefinition(), ...readToolDefinitions()] };
  if (protocolVersion === PROTOCOL_2026) {
    result._meta = { "io.modelcontextprotocol/protocolVersion": protocolVersion };
  }
  return result;
}

function parseReadArgs(tool: McpReadTool, args: unknown, nowMs: number): ParsedRead | null {
  if (!isRecord(args)) return null;
  const clientId = clientIdOf(args.clientId);
  const limit = mcpReadLimit(args.limit);
  const cursor = cursorOf(args.cursor);
  if (!clientId || limit == null || cursor === undefined) return null;

  if (tool === "get_gsc_performance") {
    if (!keysAllowed(args, GSC_KEYS)) return null;
    const view = viewOf(args.view);
    if (!view) return null;
    const defaults = mcpDefaultGscRange(nowMs);
    const dateStart = args.dateStart === undefined ? defaults.dateStart : args.dateStart;
    const dateEnd = args.dateEnd === undefined ? defaults.dateEnd : args.dateEnd;
    if (typeof dateStart !== "string" || typeof dateEnd !== "string") return null;
    if (mcpInclusiveDays(dateStart, dateEnd) == null) return null;
    return { tool, clientId, limit, cursor, dateStart, dateEnd, view };
  }

  if (tool === "get_seo_findings") {
    if (!keysAllowed(args, FINDING_KEYS)) return null;
    const status = statusOf(args.status);
    if (!status) return null;
    return { tool, clientId, limit, cursor, status };
  }

  if (!keysAllowed(args, CATALOG_KEYS)) return null;
  return { tool, clientId, limit, cursor };
}

export async function callReadTool(input: {
  tool: string;
  args: unknown;
  identityId: string;
  protocolVersion: string;
  nowMs: number;
  read: (request: McpReadRequest) => Promise<McpReadResponse>;
}): Promise<ReadOutcome> {
  if (!isMcpReadTool(input.tool)) {
    return fail(400, "protocol", "error", "Unknown tool");
  }
  const request = parseReadArgs(input.tool, input.args, input.nowMs);
  if (!request || !UUID.test(input.identityId)) {
    return fail(400, "protocol", "error", "Invalid arguments");
  }
  let remote: McpReadResponse;
  try {
    remote = await input.read({ ...request, identityId: input.identityId });
  } catch {
    return fail(500, "call", "error", "Read unavailable");
  }
  if (!remote.ok) {
    if (remote.status === 404) return fail(404, "not_granted", "denied", "not found or not allowed");
    if (remote.status === 403) return fail(403, "insufficient_scope", "denied", "insufficient_scope", "cerevex.read");
    if (remote.status === 400) return fail(400, "protocol", "error", "Invalid arguments");
    return fail(500, "call", "error", "Read unavailable");
  }
  const payload = projectRead(input.tool, remote.read, request);
  if (!payload) return fail(500, "call", "error", "Read unavailable");
  return { ok: true, result: toolResult(input.protocolVersion, payload) };
}
