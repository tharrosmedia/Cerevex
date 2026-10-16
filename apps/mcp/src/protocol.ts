import { clientInfoFrom } from "./audit";

export const PROTOCOL_2026 = "2026-07-28";
export const PROTOCOL_2025 = "2025-11-25";
export const PROTOCOL_2025_06 = "2025-06-18";
export const PROTOCOL_2025_03 = "2025-03-26";
/** Latest supported revision. Returned when initialize asks for a version we do not speak. */
export const PREFERRED_PROTOCOL_VERSION = PROTOCOL_2026;
/**
 * Streamable HTTP: a request after initialize that omits MCP-Protocol-Version
 * is treated as this revision.
 */
export const DEFAULT_PROTOCOL_VERSION = PROTOCOL_2025_03;
export const MCP_SERVER_VERSION = "0.1.0";
export const SUPPORTED_PROTOCOL_VERSIONS = [
  PROTOCOL_2026,
  PROTOCOL_2025,
  PROTOCOL_2025_06,
  PROTOCOL_2025_03,
] as const;
export type SupportedProtocol = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_HEADER_MISMATCH = -32020;
export const JSON_RPC_UNSUPPORTED_PROTOCOL = -32022;
export const JSON_RPC_CLOSED = -32000;

const VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const NAMED_METHODS = new Set(["tools/call", "resources/read", "prompts/get"]);

export type HeaderName = "MCP-Protocol-Version" | "Mcp-Method" | "Mcp-Name";

export type ParsedMcpRequest = {
  protocolVersion: SupportedProtocol;
  id: string | number | null;
  method: string;
  tool: string | null;
  arguments: unknown;
  clientName: string | null;
  clientVersion: string | null;
};

export type ParseFailure =
  | { kind: "invalid_request"; id: string | number | null }
  | { kind: "unsupported_version"; id: string | number | null; requested: string }
  | { kind: "header_mismatch"; id: string | number | null; header: HeaderName };

export function requestedVersionLabel(value: string | null): string {
  if (value && VERSION.test(value)) return value;
  return "invalid";
}

export function jsonRpcId(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\x20-\x7e]+$/.test(value)) {
    return value;
  }
  return null;
}

/** Header values with control characters are malformed. Names are case-insensitive at the HTTP layer. */
export function cleanHeaderValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const [type, ...params] = value.split(";").map((part) => part.trim().toLowerCase());
  if (type !== "application/json") return false;
  for (const param of params) {
    if (!param.startsWith("charset=")) continue;
    if (param.slice("charset=".length).trim() !== "utf-8") return false;
  }
  return true;
}

/**
 * Mcp-Name may use the spec's base64 sentinel. The decoded value is what we
 * compare to the body. A sentinel that is not canonical base64 is malformed.
 */
export function decodeMirroredName(value: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const sentinel = /^=\?base64\?([A-Za-z0-9+/]+={0,2})\?=$/.exec(value);
  if (!sentinel) {
    if (!/^[\x21-\x7e]+$/.test(value)) return null;
    return value;
  }
  const payload = sentinel[1];
  if (!payload || payload.length % 4 === 1) return null;
  const decoded = Buffer.from(payload, "base64").toString("utf8");
  const roundTrip = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
  if (roundTrip !== payload.replace(/=+$/, "")) return null;
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSupportedProtocol(value: string | null | undefined): value is SupportedProtocol {
  return value != null && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

/** Spec negotiation: echo a supported request, otherwise the server's preferred revision. */
export function negotiateProtocolVersion(requested: string | null | undefined): SupportedProtocol {
  if (isSupportedProtocol(requested)) return requested;
  return PREFERRED_PROTOCOL_VERSION;
}

export function initializeResult(protocolVersion: string, serverName: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: serverName, version: MCP_SERVER_VERSION },
  };
  if (protocolVersion === PROTOCOL_2026) {
    result._meta = { "io.modelcontextprotocol/protocolVersion": protocolVersion };
  }
  return result;
}

function callArguments(params: Record<string, unknown> | null): unknown {
  if (!params || !Object.prototype.hasOwnProperty.call(params, "arguments")) return null;
  return params.arguments;
}

function bodyName(params: Record<string, unknown>, method: string): string | null {
  const key = method === "resources/read" ? "uri" : "name";
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function initializeClient(params: Record<string, unknown> | null): { name: string | null; version: string | null } {
  const fromParams = clientInfoFrom(params ? params.clientInfo : null);
  if (fromParams.name || fromParams.version) return fromParams;
  const meta = params && isRecord(params._meta) ? params._meta : null;
  if (!meta) return fromParams;
  return clientInfoFrom(meta["io.modelcontextprotocol/clientInfo"]);
}

function namesMatch(header: string | null, body: string | null): boolean {
  if (!header || body == null) return false;
  const decoded = decodeMirroredName(header);
  if (decoded == null) return false;
  return decoded === body;
}

export function parseMcpRequest(input: {
  protocolHeader: string | null;
  methodHeader: string | null;
  nameHeader: string | null;
  body: unknown;
}): { ok: true; request: ParsedMcpRequest } | { ok: false; failure: ParseFailure } {
  if (!isRecord(input.body)) return { ok: false, failure: { kind: "invalid_request", id: null } };
  const hasId = Object.prototype.hasOwnProperty.call(input.body, "id");
  if (hasId && jsonRpcId(input.body.id) === null) {
    return { ok: false, failure: { kind: "invalid_request", id: null } };
  }
  const id = hasId ? jsonRpcId(input.body.id) : null;
  if (input.body.jsonrpc !== "2.0" || typeof input.body.method !== "string" || input.body.method.length === 0 || input.body.method.length > 128) {
    return { ok: false, failure: { kind: "invalid_request", id } };
  }
  const method = input.body.method;
  const params = isRecord(input.body.params) ? input.body.params : null;
  const protocolHeader = cleanHeaderValue(input.protocolHeader);
  const methodHeader = cleanHeaderValue(input.methodHeader);
  const nameHeader = cleanHeaderValue(input.nameHeader);

  if (method === "initialize") {
    if (protocolHeader && !isSupportedProtocol(protocolHeader)) {
      return {
        ok: false,
        failure: { kind: "unsupported_version", id, requested: requestedVersionLabel(protocolHeader) },
      };
    }
    if (methodHeader && methodHeader !== method) {
      return { ok: false, failure: { kind: "header_mismatch", id, header: "Mcp-Method" } };
    }
    const requested = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
    const fromHeader = isSupportedProtocol(protocolHeader) ? protocolHeader : null;
    const protocolVersion = negotiateProtocolVersion(requested ?? fromHeader);
    const client = initializeClient(params);
    return {
      ok: true,
      request: {
        protocolVersion,
        id,
        method,
        tool: null,
        arguments: null,
        clientName: client.name,
        clientVersion: client.version,
      },
    };
  }

  const resolvedHeader = protocolHeader ?? DEFAULT_PROTOCOL_VERSION;
  if (!isSupportedProtocol(resolvedHeader)) {
    return {
      ok: false,
      failure: { kind: "unsupported_version", id, requested: requestedVersionLabel(protocolHeader) },
    };
  }
  const protocolVersion = resolvedHeader;

  if (protocolVersion === PROTOCOL_2026) {
    const meta = params && isRecord(params._meta) ? params._meta : null;
    const bodyVersion = meta ? meta["io.modelcontextprotocol/protocolVersion"] : undefined;
    if (bodyVersion !== protocolVersion) {
      return { ok: false, failure: { kind: "header_mismatch", id, header: "MCP-Protocol-Version" } };
    }
    if (!methodHeader || methodHeader !== method) {
      return { ok: false, failure: { kind: "header_mismatch", id, header: "Mcp-Method" } };
    }
    let tool: string | null = null;
    if (NAMED_METHODS.has(method)) {
      const fromBody = params ? bodyName(params, method) : null;
      if (!namesMatch(nameHeader, fromBody)) {
        return { ok: false, failure: { kind: "header_mismatch", id, header: "Mcp-Name" } };
      }
      tool = fromBody;
    }
    const client = clientInfoFrom(meta ? meta["io.modelcontextprotocol/clientInfo"] : null);
    return {
      ok: true,
      request: {
        protocolVersion,
        id,
        method,
        tool,
        arguments: callArguments(params),
        clientName: client.name,
        clientVersion: client.version,
      },
    };
  }

  if (methodHeader && methodHeader !== method) {
    return { ok: false, failure: { kind: "header_mismatch", id, header: "Mcp-Method" } };
  }
  let tool: string | null = null;
  if (NAMED_METHODS.has(method)) {
    const fromBody = params ? bodyName(params, method) : null;
    tool = fromBody;
    if (nameHeader && !namesMatch(nameHeader, fromBody)) {
      return { ok: false, failure: { kind: "header_mismatch", id, header: "Mcp-Name" } };
    }
  }
  const client = clientInfoFrom(params ? params.clientInfo : null);
  return {
    ok: true,
    request: {
      protocolVersion,
      id,
      method,
      tool,
      arguments: callArguments(params),
      clientName: client.name,
      clientVersion: client.version,
    },
  };
}
