import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { rejectUntilScopedBearer, type McpAuthenticator, type McpIdentity } from "./auth";
import { buildSecurityAuditEntry, type AuditReason, type AuditResult, type SecurityAuditEntry } from "./audit";
import { MAX_MCP_BODY_BYTES, readLimitedText } from "./body";
import type { GuardClient } from "./guards";
import { asRemoteKillSwitch, connectorKilled, envForcesOff } from "./kill-switch";
import { classifyOrigin, parseAllowedOrigins } from "./origin";
import { PING_TOOL_NAME, pingCallResult, pingToolsList } from "./ping";
import {
  JSON_RPC_CLOSED,
  JSON_RPC_HEADER_MISMATCH,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_UNSUPPORTED_PROTOCOL,
  SUPPORTED_PROTOCOL_VERSIONS,
  isJsonContentType,
  parseMcpRequest,
} from "./protocol";

export const SERVICE_NAME = "cerevex-mcp";

export type McpAppDeps = {
  allowedOrigins: string;
  killSwitchEnv: string | undefined;
  guards: GuardClient;
  authenticator?: McpAuthenticator;
};

type JsonRpcError = {
  code: number;
  message: string;
  data?: Record<string, unknown>;
};

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export function createApp(deps: McpAppDeps) {
  const authenticator = deps.authenticator ?? rejectUntilScopedBearer;
  const allowedOrigins = parseAllowedOrigins(deps.allowedOrigins);
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ ok: true, service: SERVICE_NAME });
  });

  app.all("/mcp", async (c) => {
    const started = Date.now();
    const requestId = randomUUID();
    const origin = classifyOrigin(c.req.header("origin"), allowedOrigins);

    const reject = async (input: {
      status: 400 | 401 | 403 | 404 | 405 | 500;
      id: string | number | null;
      error: JsonRpcError;
      reason: AuditReason;
      result: AuditResult;
      protocolVersion?: string | null;
      method?: string | null;
      tool?: string | null;
      clientName?: string | null;
      clientVersion?: string | null;
      identity?: McpIdentity | null;
      headers?: Record<string, string>;
    }) => {
      await writeAudit({
        requestId,
        started,
        result: input.result,
        httpStatus: input.status,
        protocolVersion: input.protocolVersion ?? null,
        method: input.method ?? null,
        tool: input.tool ?? null,
        clientName: input.clientName ?? null,
        clientVersion: input.clientVersion ?? null,
        reason: input.reason,
        identity: input.identity ?? null,
      });
      return c.json({ jsonrpc: "2.0", id: input.id, error: input.error }, input.status, {
        ...BASE_HEADERS,
        "x-request-id": requestId,
        ...input.headers,
      });
    };

    if (origin === "rejected") {
      return reject({
        status: 403,
        id: null,
        reason: "origin",
        result: "denied",
        error: { code: JSON_RPC_CLOSED, message: "Origin not allowed" },
      });
    }

    let remote: unknown = "tripped";
    if (!envForcesOff(deps.killSwitchEnv)) {
      try {
        remote = asRemoteKillSwitch(await deps.guards.readKillSwitch());
      } catch {
        remote = "unreachable";
      }
    }
    if (connectorKilled(deps.killSwitchEnv, remote)) {
      return reject({
        status: 403,
        id: null,
        reason: "kill_switch",
        result: "denied",
        error: { code: JSON_RPC_CLOSED, message: "Connector is off" },
      });
    }

    if (c.req.method !== "POST") {
      return reject({
        status: 405,
        id: null,
        reason: "method",
        result: "error",
        error: { code: JSON_RPC_CLOSED, message: "Method not allowed" },
        headers: { allow: "POST" },
      });
    }

    if (!isJsonContentType(c.req.header("content-type"))) {
      return reject({
        status: 400,
        id: null,
        reason: "protocol",
        result: "error",
        error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid request" },
      });
    }

    const body = await readLimitedText(c.req.raw, MAX_MCP_BODY_BYTES);
    let parsedBody: unknown = undefined;
    if (body.ok && body.text.length > 0) {
      try {
        parsedBody = JSON.parse(body.text);
      } catch {
        parsedBody = undefined;
      }
    }
    if (!body.ok || parsedBody === undefined) {
      return reject({
        status: 400,
        id: null,
        reason: "protocol",
        result: "error",
        error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid request" },
      });
    }

    const parsed = parseMcpRequest({
      protocolHeader: c.req.header("mcp-protocol-version") ?? null,
      methodHeader: c.req.header("mcp-method") ?? null,
      nameHeader: c.req.header("mcp-name") ?? null,
      body: parsedBody,
    });
    if (!parsed.ok) {
      if (parsed.failure.kind === "unsupported_version") {
        return reject({
          status: 400,
          id: parsed.failure.id,
          reason: "headers",
          result: "error",
          protocolVersion: parsed.failure.requested === "invalid" ? null : parsed.failure.requested,
          error: {
            code: JSON_RPC_UNSUPPORTED_PROTOCOL,
            message: "Unsupported protocol version",
            data: {
              supported: [...SUPPORTED_PROTOCOL_VERSIONS],
              requested: parsed.failure.requested,
            },
          },
        });
      }
      if (parsed.failure.kind === "header_mismatch") {
        return reject({
          status: 400,
          id: parsed.failure.id,
          reason: "headers",
          result: "error",
          error: {
            code: JSON_RPC_HEADER_MISMATCH,
            message: `Header mismatch: ${parsed.failure.header}`,
          },
        });
      }
      return reject({
        status: 400,
        id: parsed.failure.id,
        reason: "protocol",
        result: "error",
        error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid request" },
      });
    }

    const request = parsed.request;
    let decision: { ok: false } | { ok: true; identity: McpIdentity };
    try {
      decision = await authenticator(c.req.header("authorization") ?? null);
    } catch {
      decision = { ok: false };
    }
    const unauthenticated = () =>
      reject({
        status: 401,
        id: request.id,
        reason: "unauthenticated",
        result: "denied",
        protocolVersion: request.protocolVersion,
        method: request.method,
        tool: request.tool,
        clientName: request.clientName,
        clientVersion: request.clientVersion,
        headers: { "www-authenticate": 'Bearer error="invalid_token"' },
        error: { code: JSON_RPC_CLOSED, message: "Authentication required" },
      });
    if (!decision.ok) return unauthenticated();
    const identity = decision.identity;
    if (!identity.id || !identity.name) return unauthenticated();
    if (request.method === "tools/list") {
      return succeed(c, requestId, started, request, identity, pingToolsList(request.protocolVersion));
    }
    if (request.method === "tools/call" && request.tool === PING_TOOL_NAME) {
      return succeed(c, requestId, started, request, identity, pingCallResult(request.protocolVersion));
    }
    const unknownTool = request.method === "tools/call";
    return reject({
      status: unknownTool ? 400 : 404,
      id: request.id,
      reason: "protocol",
      result: "error",
      protocolVersion: request.protocolVersion,
      method: request.method,
      tool: request.tool,
      clientName: request.clientName,
      clientVersion: request.clientVersion,
      identity,
      error: unknownTool
        ? { code: JSON_RPC_INVALID_PARAMS, message: "Unknown tool" }
        : { code: JSON_RPC_METHOD_NOT_FOUND, message: "Method not found" },
    });
  });

  async function writeAudit(input: {
    requestId: string;
    started: number;
    result: AuditResult;
    httpStatus: number;
    protocolVersion: string | null;
    method: string | null;
    tool: string | null;
    clientName: string | null;
    clientVersion: string | null;
    reason: AuditReason;
    identity: McpIdentity | null;
  }): Promise<boolean> {
    const entry: SecurityAuditEntry = buildSecurityAuditEntry({
      requestId: input.requestId,
      result: input.result,
      httpStatus: input.httpStatus,
      protocolVersion: input.protocolVersion,
      method: input.method,
      tool: input.tool,
      clientName: input.clientName,
      clientVersion: input.clientVersion,
      latencyMs: Date.now() - input.started,
      reason: input.reason,
      identity: input.identity,
    });
    try {
      await deps.guards.writeSecurityAudit(entry);
      return true;
    } catch {
      return false;
    }
  }

  async function succeed(
    c: { json: (body: unknown, status: number, headers: Record<string, string>) => Response },
    requestId: string,
    started: number,
    request: { protocolVersion: string; id: string | number | null; method: string; tool: string | null; clientName: string | null; clientVersion: string | null },
    identity: McpIdentity,
    result: Record<string, unknown>,
  ) {
    const logged = await writeAudit({
      requestId,
      started,
      result: "ok",
      httpStatus: 200,
      protocolVersion: request.protocolVersion,
      method: request.method,
      tool: request.tool,
      clientName: request.clientName,
      clientVersion: request.clientVersion,
      reason: "call",
      identity,
    });
    if (!logged) {
      return c.json(
        { jsonrpc: "2.0", id: request.id, error: { code: JSON_RPC_CLOSED, message: "Audit log unavailable" } },
        500,
        { ...BASE_HEADERS, "x-request-id": requestId },
      );
    }
    return c.json({ jsonrpc: "2.0", id: request.id, result }, 200, {
      ...BASE_HEADERS,
      "x-request-id": requestId,
    });
  }

  return app;
}
