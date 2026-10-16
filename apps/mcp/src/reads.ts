import {
  MCP_READ_DEFAULT_LIMIT,
  MCP_READ_MAX_LIMIT,
  isMcpReadTool,
  mcpDefaultGscRange,
  mcpInclusiveDays,
  mcpReadCursor,
  mcpReadLimit,
  projectMcpBrainRead,
  type McpReadTool,
} from "@cerevex/contracts";
import type { AuditReason, AuditResult } from "./audit";
import type { McpReadRequest, McpReadResponse } from "./guards";
import { pingToolDefinition } from "./ping";
import { submitToolDefinition } from "./submit";
import { PROTOCOL_2026 } from "./protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,80}$/;
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

/** Brain already stripped the row. Project again so a stub or an extra field cannot pass through. */
function projectRead(tool: McpReadTool, read: Record<string, unknown>, request: ParsedRead): Record<string, unknown> | null {
  const projected = projectMcpBrainRead(
    {
      tool,
      clientId: request.clientId,
      limit: request.limit,
      dateStart: request.dateStart,
      dateEnd: request.dateEnd,
      view: request.view,
      status: request.status,
    },
    read,
  );
  return projected ? { ...projected } : null;
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
  const result: Record<string, unknown> = {
    tools: [pingToolDefinition(), ...readToolDefinitions(), submitToolDefinition()],
  };
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
    if (!cursorFits(tool, cursor, view)) return null;
    return { tool, clientId, limit, cursor, dateStart, dateEnd, view };
  }

  if (tool === "get_seo_findings") {
    if (!keysAllowed(args, FINDING_KEYS)) return null;
    const status = statusOf(args.status);
    if (!status || !cursorFits(tool, cursor)) return null;
    return { tool, clientId, limit, cursor, status };
  }

  if (!keysAllowed(args, CATALOG_KEYS) || !cursorFits(tool, cursor)) return null;
  return { tool, clientId, limit, cursor };
}

function cursorFits(tool: McpReadTool, cursor: string | null, view?: "queries" | "pages" | "both"): boolean {
  const parsed = mcpReadCursor(tool, cursor);
  if (!parsed) return false;
  if (cursor == null || tool !== "get_gsc_performance" || parsed.tool !== "get_gsc_performance") return true;
  if (view === "queries") return parsed.side === "queries";
  if (view === "pages") return parsed.side === "pages";
  return true;
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
