import {
  MCP_BRAIN_READ_CALLER,
  MCP_BRAIN_READ_CALLER_HEADER,
  MCP_BRAIN_READ_PATH,
  projectMcpBrainRead,
  type McpBrainRead,
  type McpReadTool,
} from "@cerevex/contracts";

const READ_TIMEOUT_MS = 8_000;

export type BrainReadRequest = {
  tool: McpReadTool;
  identityId: string;
  clientId: string;
  limit: number;
  cursor: string | null;
  dateStart?: string;
  dateEnd?: string;
  view?: "queries" | "pages" | "both";
  status?: "open" | "all";
};

export type BrainReadResult =
  | { ok: true; read: McpBrainRead }
  | { ok: false; status: 400 | 403 | 500 };

/**
 * Existing console origin. Not a new env var.
 * Production matches the ads shell fallback when CONSOLE_ORIGIN is unset.
 */
export function brainConsoleOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.CONSOLE_ORIGIN ?? env.NEXT_PUBLIC_CONSOLE_ORIGIN ?? "").trim();
  if (raw) return originOf(raw);
  if (env.NODE_ENV === "production") return "https://cerevex.store";
  return "http://127.0.0.1:3000";
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function fetchBrainMcpRead(
  request: BrainReadRequest,
  options: {
    fetchImpl?: typeof fetch;
    origin?: string | null;
    internalKey?: string | null;
  } = {},
): Promise<BrainReadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = options.origin === undefined ? brainConsoleOrigin() : options.origin;
  const internalKey = options.internalKey === undefined ? process.env.ADS_INTERNAL_KEY : options.internalKey;
  if (!origin || !internalKey || internalKey.trim() !== internalKey) return { ok: false, status: 500 };
  const url = new URL(MCP_BRAIN_READ_PATH, origin);
  url.searchParams.set("tool", request.tool);
  url.searchParams.set("identityId", request.identityId);
  url.searchParams.set("clientId", request.clientId);
  url.searchParams.set("limit", String(request.limit));
  if (request.cursor) url.searchParams.set("cursor", request.cursor);
  if (request.dateStart) url.searchParams.set("dateStart", request.dateStart);
  if (request.dateEnd) url.searchParams.set("dateEnd", request.dateEnd);
  if (request.view) url.searchParams.set("view", request.view);
  if (request.status) url.searchParams.set("status", request.status);
  const href = url.toString();
  if (href.includes(internalKey)) return { ok: false, status: 500 };

  let response: Response;
  try {
    response = await fetchImpl(href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "x-cerevex-internal-key": internalKey,
        [MCP_BRAIN_READ_CALLER_HEADER]: MCP_BRAIN_READ_CALLER,
      },
    });
  } catch {
    return { ok: false, status: 500 };
  }
  if (response.status === 400) return { ok: false, status: 400 };
  if (response.status === 403) return { ok: false, status: 403 };
  if (response.status < 200 || response.status >= 300) return { ok: false, status: 500 };
  try {
    const body = (await response.json()) as { ok?: unknown; read?: unknown };
    if (body?.ok !== true) return { ok: false, status: 500 };
    const read = projectMcpBrainRead(request, body.read);
    if (!read) return { ok: false, status: 500 };
    return { ok: true, read };
  } catch {
    return { ok: false, status: 500 };
  }
}
