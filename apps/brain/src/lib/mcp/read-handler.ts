import {
  MCP_BRAIN_READ_CALLER,
  MCP_BRAIN_READ_CALLER_HEADER,
  isMcpReadTool,
  mcpGscReadVisible,
  mcpInclusiveDays,
  mcpReadCursor,
  mcpReadLimit,
  mcpReadLogEvent,
  projectMcpBrainRead,
  type McpBrainRead,
  type McpReadCursor,
  type McpReadLogEvent,
  type McpReadTool,
} from "@cerevex/contracts";
import type { McpReadGrant } from "./read-grant";
import type { McpReadPage } from "./read-rows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type McpBrainReadDeps = {
  keyMatches: (provided: string | null) => boolean;
  workspaceId: () => string | null;
  loadGrant: (identityId: string, clientId: string, workspaceId: string) => Promise<McpReadGrant>;
  loadPage: (input: {
    tool: McpReadTool;
    storeId: string;
    limit: number;
    cursor: McpReadCursor;
    dateStart?: string;
    dateEnd?: string;
    view?: "queries" | "pages" | "both";
    status?: "open" | "all";
    gscVisible: boolean;
  }) => Promise<McpReadPage>;
  log: (event: McpReadLogEvent) => void;
};

type Parsed = {
  tool: McpReadTool;
  identityId: string;
  clientId: string;
  limit: number;
  cursor: McpReadCursor;
  dateStart?: string;
  dateEnd?: string;
  view?: "queries" | "pages" | "both";
  status?: "open" | "all";
};

function json(body: { ok: false } | { ok: true; read: McpBrainRead }, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function headerValue(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseRead(url: URL): Parsed | null {
  const toolRaw = url.searchParams.get("tool");
  if (!toolRaw || !isMcpReadTool(toolRaw)) return null;
  const identityId = url.searchParams.get("identityId");
  const clientId = url.searchParams.get("clientId");
  if (!identityId || !UUID.test(identityId) || !clientId || !UUID.test(clientId)) return null;
  const limit = mcpReadLimit(limitParam(url.searchParams.get("limit")));
  if (limit == null) return null;
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = mcpReadCursor(toolRaw, cursorRaw == null || cursorRaw === "" ? null : cursorRaw);
  if (!cursor) return null;

  if (toolRaw === "get_gsc_performance") {
    const viewRaw = url.searchParams.get("view");
    const view = viewRaw == null || viewRaw === "" ? "both" : viewRaw;
    if (view !== "queries" && view !== "pages" && view !== "both") return null;
    const dateStart = url.searchParams.get("dateStart");
    const dateEnd = url.searchParams.get("dateEnd");
    if (!dateStart || !dateEnd || mcpInclusiveDays(dateStart, dateEnd) == null) return null;
    const gscCursor: McpReadCursor = cursorRaw == null || cursorRaw === ""
      ? { tool: "get_gsc_performance", side: view === "pages" ? "pages" : "queries", offset: 0 }
      : cursor;
    if (gscCursor.tool !== "get_gsc_performance") return null;
    if (view === "pages" && gscCursor.side !== "pages") return null;
    if (view !== "pages" && gscCursor.side !== "queries") return null;
    return { tool: toolRaw, identityId, clientId, limit, cursor: gscCursor, dateStart, dateEnd, view };
  }

  if (toolRaw === "get_seo_findings") {
    const statusRaw = url.searchParams.get("status");
    const status = statusRaw == null || statusRaw === "" ? "open" : statusRaw;
    if (status !== "open" && status !== "all") return null;
    if (url.searchParams.get("dateStart") || url.searchParams.get("dateEnd") || url.searchParams.get("view")) return null;
    return { tool: toolRaw, identityId, clientId, limit, cursor, status };
  }

  if (url.searchParams.get("dateStart") || url.searchParams.get("dateEnd") || url.searchParams.get("view") || url.searchParams.get("status")) {
    return null;
  }
  return { tool: toolRaw, identityId, clientId, limit, cursor };
}

function limitParam(value: string | null): unknown {
  if (value == null || value === "") return undefined;
  if (!/^\d+$/.test(value)) return value;
  return Number(value);
}

function allowedKeys(tool: McpReadTool): Set<string> {
  if (tool === "get_gsc_performance") return new Set(["tool", "identityId", "clientId", "limit", "cursor", "dateStart", "dateEnd", "view"]);
  if (tool === "get_seo_findings") return new Set(["tool", "identityId", "clientId", "limit", "cursor", "status"]);
  return new Set(["tool", "identityId", "clientId", "limit", "cursor"]);
}

export async function handleMcpBrainRead(request: Request, deps: McpBrainReadDeps): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false }, 405);
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return json({ ok: false }, 400);
  }
  const providedKey = headerValue(request, "x-cerevex-internal-key");
  if (providedKey && url.toString().includes(providedKey)) return json({ ok: false }, 401);
  if (!deps.keyMatches(providedKey)) return json({ ok: false }, 401);
  if (headerValue(request, MCP_BRAIN_READ_CALLER_HEADER) !== MCP_BRAIN_READ_CALLER) return json({ ok: false }, 401);

  const toolRaw = url.searchParams.get("tool");
  if (!toolRaw || !isMcpReadTool(toolRaw)) return json({ ok: false }, 400);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys(toolRaw).has(key)) return json({ ok: false }, 400);
  }
  const parsed = parseRead(url);
  if (!parsed) return json({ ok: false }, 400);

  const workspaceId = deps.workspaceId();
  if (!workspaceId) {
    deps.log(mcpReadLogEvent({ identityId: parsed.identityId, clientId: parsed.clientId, tool: parsed.tool, rows: 0 }));
    return json({ ok: false }, 403);
  }

  let grant: McpReadGrant;
  try {
    grant = await deps.loadGrant(parsed.identityId, parsed.clientId, workspaceId);
  } catch {
    deps.log(mcpReadLogEvent({ identityId: parsed.identityId, clientId: parsed.clientId, tool: parsed.tool, rows: 0 }));
    return json({ ok: false }, 500);
  }
  if (!grant.ok) {
    deps.log(mcpReadLogEvent({ identityId: parsed.identityId, clientId: parsed.clientId, tool: parsed.tool, rows: 0 }));
    return json({ ok: false }, 403);
  }

  const gscVisible = mcpGscReadVisible(grant.workspaceSettings, grant.clientSettings);
  const hiddenGsc = parsed.tool === "get_gsc_performance" && !gscVisible;
  let page: McpReadPage = {
    queries: [],
    pages: [],
    findings: [],
    products: [],
    collections: [],
    lastSyncedAt: null,
    nextCursor: null,
  };
  if (!hiddenGsc && grant.siteId) {
    try {
      page = await deps.loadPage({
        tool: parsed.tool,
        storeId: grant.siteId,
        limit: parsed.limit,
        cursor: parsed.cursor,
        dateStart: parsed.dateStart,
        dateEnd: parsed.dateEnd,
        view: parsed.view,
        status: parsed.status,
        gscVisible,
      });
    } catch {
      deps.log(mcpReadLogEvent({ identityId: parsed.identityId, clientId: parsed.clientId, tool: parsed.tool, rows: 0 }));
      return json({ ok: false }, 500);
    }
  }

  const read = projectMcpBrainRead(
    {
      tool: parsed.tool,
      clientId: parsed.clientId,
      limit: parsed.limit,
      dateStart: parsed.dateStart,
      dateEnd: parsed.dateEnd,
      view: parsed.view,
      status: parsed.status,
    },
    {
      clientId: parsed.clientId,
      storeId: grant.siteId,
      lastSyncedAt: page.lastSyncedAt,
      sourceSystem: "brain",
      availability: "ready",
      limit: parsed.limit,
      nextCursor: page.nextCursor,
      queries: page.queries,
      pages: page.pages,
      findings: page.findings,
      products: page.products,
      collections: page.collections,
      dateStart: page.dateStart,
      dateEnd: page.dateEnd,
    },
  );
  if (!read) {
    deps.log(mcpReadLogEvent({ identityId: parsed.identityId, clientId: parsed.clientId, tool: parsed.tool, rows: 0 }));
    return json({ ok: false }, 500);
  }
  deps.log(mcpReadLogEvent({ identityId: parsed.identityId, clientId: parsed.clientId, tool: parsed.tool, rows: read.returned }));
  return json({ ok: true, read }, 200);
}
