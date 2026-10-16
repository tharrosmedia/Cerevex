import type { McpReadTool } from "@cerevex/contracts";
import { remoteFromApiBody, type RemoteKillSwitch } from "./kill-switch";
import type { SecurityAuditEntry } from "./audit";

/**
 * Typed façade over the ads API. This process does not open a database connection.
 * The ads routes sit behind the same service-principal guard the console uses.
 */
export type VerifiedAgent = {
  id: string;
  name: string;
  scopes: string[];
};

export type McpReadRequest = {
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

export type McpReadResponse =
  | { ok: true; read: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404 | 500 };

export type GuardClient = {
  readKillSwitch(): Promise<RemoteKillSwitch>;
  writeSecurityAudit(entry: SecurityAuditEntry): Promise<void>;
  verifyToken(tokenHash: string): Promise<VerifiedAgent | null>;
  readGranted(request: McpReadRequest): Promise<McpReadResponse>;
};

/** Fail closed when a test double has not wired reads. */
export const unreadGranted: GuardClient["readGranted"] = async () => ({ ok: false, status: 404 });

const CONNECTOR_PATH = "/internal/mcp/connector";
const AUDIT_PATH = "/internal/mcp/security-audit";
const VERIFY_PATH = "/internal/mcp/verify";
const READ_PATH = "/internal/mcp/read";
const TOKEN_HASH = /^[0-9a-f]{64}$/;

export function guardEndpoint(base: string, path: string): string | null {
  let root: URL;
  try {
    root = new URL(base);
  } catch {
    return null;
  }
  if (root.username || root.password || root.search || root.hash) return null;
  if (root.protocol !== "http:" && root.protocol !== "https:") return null;
  if (root.pathname !== "/" && root.pathname !== "") return null;
  const endpoint = new URL(path, root);
  if (endpoint.origin !== root.origin) return null;
  if (endpoint.search || endpoint.hash || endpoint.username || endpoint.password) return null;
  return endpoint.toString();
}

function usableKey(value: string | undefined): string | null {
  if (!value) return null;
  if (value.trim() !== value) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function createHttpGuardClient(options: {
  apiUrl: string | undefined;
  mcpKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): GuardClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const key = usableKey(options.mcpKey);
  const base = options.apiUrl?.trim() ?? "";

  async function call(path: string, method: "GET" | "POST", body?: string): Promise<Response | null> {
    if (!key || !base) return null;
    const url = guardEndpoint(base, path);
    if (!url || url.includes(key)) return null;
    try {
      return await fetchImpl(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-cerevex-mcp-key": key,
        },
        body,
      });
    } catch {
      return null;
    }
  }

  return {
    async readKillSwitch() {
      const response = await call(CONNECTOR_PATH, "GET");
      if (!response || response.status < 200 || response.status >= 300) return "unreachable";
      try {
        return remoteFromApiBody(await response.json());
      } catch {
        return "unreachable";
      }
    },
    async writeSecurityAudit(entry) {
      const response = await call(AUDIT_PATH, "POST", JSON.stringify(entry));
      if (!response || response.status < 200 || response.status >= 300) {
        throw new Error("mcp guard request failed");
      }
    },
    async verifyToken(tokenHash) {
      if (!TOKEN_HASH.test(tokenHash)) return null;
      const response = await call(VERIFY_PATH, "POST", JSON.stringify({ tokenHash }));
      if (!response || response.status < 200 || response.status >= 300) return null;
      try {
        return agentFromBody(await response.json());
      } catch {
        return null;
      }
    },
    async readGranted(request) {
      const response = await call(READ_PATH, "POST", JSON.stringify(request));
      if (!response) return { ok: false, status: 500 };
      if (response.status === 404) return { ok: false, status: 404 };
      if (response.status === 403) return { ok: false, status: 403 };
      if (response.status === 400) return { ok: false, status: 400 };
      if (response.status < 200 || response.status >= 300) return { ok: false, status: 500 };
      try {
        return readFromBody(await response.json());
      } catch {
        return { ok: false, status: 500 };
      }
    },
  };
}

function readFromBody(body: unknown): McpReadResponse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 500 };
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.read === null || typeof record.read !== "object" || Array.isArray(record.read)) {
    return { ok: false, status: 500 };
  }
  return { ok: true, read: record.read as Record<string, unknown> };
}

function agentFromBody(body: unknown): VerifiedAgent | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.ok !== true) return null;
  const identity = record.identity;
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) return null;
  const row = identity as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || !Array.isArray(row.scopes)) return null;
  const scopes = row.scopes.filter((scope): scope is string => typeof scope === "string");
  return { id: row.id, name: row.name, scopes };
}
