import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { rejectUntilScopedBearer, type McpAuthenticator, type McpIdentity } from "./auth";
import { createDeniedAuditAggregator } from "./audit-buffer";
import { buildSecurityAuditEntry, type AuditReason, type AuditResult, type SecurityAuditEntry } from "./audit";
import { MAX_MCP_BODY_BYTES, readLimitedText } from "./body";
import type { GuardClient } from "./guards";
import { asRemoteKillSwitch, connectorKilled, envForcesOff } from "./kill-switch";
import { cacheRemoteKillSwitch } from "./kill-switch-cache";
import { clientIpFromHeaders, createDeniedIpLimiter } from "./limiter";
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
import { requiredScope } from "./scope";

export const SERVICE_NAME = "cerevex-mcp";
export const DENIED_IP_LIMIT = 30;
export const DENIED_IP_WINDOW_MS = 60_000;
/** Under the one-minute kill-switch bound. Revocation is not cached. */
export const KILL_SWITCH_CACHE_MS = 5_000;
export const DENIED_AUDIT_FLUSH_MS = 5_000;

export type AuditControl = {
  flush: () => Promise<void>;
};

export type McpAppDeps = {
  allowedOrigins: string;
  killSwitchEnv: string | undefined;
  guards: GuardClient;
  authenticator?: McpAuthenticator;
  killSwitchTtlMs?: number;
  deniedPerIp?: number;
  deniedWindowMs?: number;
  deniedFlushMs?: number;
  now?: () => number;
  auditControl?: AuditControl;
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
  const now = deps.now ?? Date.now;
  const readKillSwitch = cacheRemoteKillSwitch(() => deps.guards.readKillSwitch(), deps.killSwitchTtlMs ?? 0, now);
  const limiter = createDeniedIpLimiter({
    limit: deps.deniedPerIp ?? DENIED_IP_LIMIT,
    windowMs: deps.deniedWindowMs ?? DENIED_IP_WINDOW_MS,
    now,
  });
  const deniedAudits = createDeniedAuditAggregator();
  const flushMs = deps.deniedFlushMs ?? 0;
  const app = new Hono();

  async function flushDeniedAudits(): Promise<void> {
    const rows = deniedAudits.drain();
    for (const entry of rows) {
      try {
        await deps.guards.writeSecurityAudit(entry);
      } catch {
        // A denied response still returns. The next window can record again.
      }
    }
  }

  if (deps.auditControl) deps.auditControl.flush = flushDeniedAudits;
  if (flushMs > 0) {
    const timer = setInterval(() => {
      void flushDeniedAudits();
    }, flushMs);
    timer.unref?.();
  }

  app.get("/health", (c) => {
    return c.json({ ok: true, service: SERVICE_NAME });
  });

  app.all("/mcp", async (c) => {
    const started = Date.now();
    const requestId = randomUUID();
    const ip = clientIpFromHeaders(c.req.raw.headers);
    const origin = classifyOrigin(c.req.header("origin"), allowedOrigins);

    const reject = async (input: {
      status: 400 | 401 | 403 | 404 | 405 | 429 | 500;
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
      recordIp?: boolean;
    }) => {
      if (input.recordIp !== false && (input.status === 401 || input.status === 403)) limiter.record(ip);
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
        immediate: flushMs <= 0,
      });
      return c.json({ jsonrpc: "2.0", id: input.id, error: input.error }, input.status, {
        ...BASE_HEADERS,
        "x-request-id": requestId,
        ...input.headers,
      });
    };

    const retryAfter = limiter.retryAfterSeconds(ip);
    if (retryAfter != null) {
      return reject({
        status: 429,
        id: null,
        reason: "rate_limited",
        result: "rate_limited",
        recordIp: false,
        headers: { "retry-after": String(retryAfter) },
        error: { code: JSON_RPC_CLOSED, message: "Rate limit exceeded" },
      });
    }

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
        remote = asRemoteKillSwitch(await readKillSwitch());
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
        recordIp: false,
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
        recordIp: false,
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
        recordIp: false,
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
          recordIp: false,
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
          recordIp: false,
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
        recordIp: false,
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
    const scopes = Array.isArray(identity.scopes) ? identity.scopes : [];
    if (!identity.id || !identity.name || scopes.length === 0) return unauthenticated();
    const needed = requiredScope(request.method, request.tool);
    if (needed && !scopes.includes(needed)) {
      return reject({
        status: 403,
        id: request.id,
        reason: "insufficient_scope",
        result: "denied",
        protocolVersion: request.protocolVersion,
        method: request.method,
        tool: request.tool,
        clientName: request.clientName,
        clientVersion: request.clientVersion,
        identity,
        headers: { "www-authenticate": `Bearer error="insufficient_scope", scope="${needed}"` },
        error: { code: JSON_RPC_CLOSED, message: "insufficient_scope" },
      });
    }
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
      recordIp: false,
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
    immediate: boolean;
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
    if (!input.immediate && (input.result === "denied" || input.result === "rate_limited")) {
      deniedAudits.add(entry);
      return true;
    }
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
      immediate: true,
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
