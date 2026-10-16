import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { rejectUntilScopedBearer, type McpAuthenticator, type McpIdentity } from "./auth";
import { createDeniedAuditAggregator } from "./audit-buffer";
import { buildSecurityAuditEntry, type AuditReason, type AuditResult, type SecurityAuditEntry } from "./audit";
import { MAX_MCP_BODY_BYTES, readLimitedText } from "./body";
import type { GuardClient } from "./guards";
import { asRemoteKillSwitch, connectorKilled, envForcesOff } from "./kill-switch";
import { cacheRemoteKillSwitch } from "./kill-switch-cache";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  clientIpFromHeaders,
  createCallWindow,
  createDeniedIpLimiter,
  createTokenBucket,
  createVerifiedTokenSet,
  createWaitingSet,
} from "./limiter";
import { bearerToken, hashMcpToken } from "./token";
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
  cleanHeaderValue,
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
/** Process-wide budget for calls that are not carrying a well-formed bearer. Not keyed by IP. */
export const GLOBAL_DENIAL_CAPACITY = 60;
export const GLOBAL_DENIAL_REFILL_PER_SECOND = 1;
/** A hash that verified OK may skip the shared lookup bucket for this long. Verify still runs every call. */
export const VERIFIED_BEARER_TTL_MS = 10 * 60_000;
/** One slot per identity. Forged tokens never enter, and a full set drops the oldest expiry. */
export const VERIFIED_BEARER_MAX = 256;
/** Brief §11. Sliding window, charged before the ads lookup for a hash that already verified. */
export const IDENTITY_CALLS_PER_MINUTE = 60;
export const IDENTITY_SUBMITS_PER_MINUTE = 30;
export const IDENTITY_WINDOW_MS = 60_000;
/**
 * A retried unknown hash, from an address with no failed lookup, may verify
 * once without taking the shared fake-token bucket. The process-wide cap
 * stops a rotating retry flood from minting a lookup per address.
 */
export const PROTECTED_FIRST_VERIFY_PER_IP = 1;
export const PROTECTED_FIRST_VERIFY_MAX = 60;
export const WAITING_BEARER_MAX = 4096;
export const WAITING_BEARER_TTL_MS = 60_000;
const PROTECTED_GLOBAL_KEY = "protected";

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
  deniedMaxIps?: number;
  globalDenialCapacity?: number;
  globalDenialRefillPerSecond?: number;
  globalBearerCapacity?: number;
  globalBearerRefillPerSecond?: number;
  failedLookupPerIp?: number;
  identityCallsPerMinute?: number;
  identitySubmitsPerMinute?: number;
  identityWindowMs?: number;
  protectedFirstVerifyPerIp?: number;
  protectedFirstVerifyPerMinute?: number;
};

function peerAddress(c: { env: unknown }): string | null {
  try {
    const address = getConnInfo(c as never).remote.address;
    return typeof address === "string" && address.length > 0 ? address : null;
  } catch {
    return null;
  }
}

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
    maxIps: deps.deniedMaxIps,
    now,
  });
  const denialCapacity = deps.globalDenialCapacity ?? GLOBAL_DENIAL_CAPACITY;
  const denialRefill = deps.globalDenialRefillPerSecond ?? GLOBAL_DENIAL_REFILL_PER_SECOND;
  const bearerCapacity = deps.globalBearerCapacity ?? denialCapacity;
  // Two buckets with the same default rates. Unauthenticated calls cannot drain the lookup budget.
  const denialBucket = createTokenBucket({ capacity: denialCapacity, refillPerSecond: denialRefill, now });
  const bearerBucket = createTokenBucket({
    capacity: bearerCapacity,
    refillPerSecond: deps.globalBearerRefillPerSecond ?? denialRefill,
    now,
  });
  const failedLookups = createDeniedIpLimiter({
    limit: deps.failedLookupPerIp ?? DENIED_IP_LIMIT,
    windowMs: deps.deniedWindowMs ?? DENIED_IP_WINDOW_MS,
    now,
  });
  const identityWindowMs = deps.identityWindowMs ?? IDENTITY_WINDOW_MS;
  const identityCalls = createCallWindow({
    limit: deps.identityCallsPerMinute ?? IDENTITY_CALLS_PER_MINUTE,
    windowMs: identityWindowMs,
    maxKeys: VERIFIED_BEARER_MAX,
    now,
  });
  const identitySubmits = createCallWindow({
    limit: deps.identitySubmitsPerMinute ?? IDENTITY_SUBMITS_PER_MINUTE,
    windowMs: identityWindowMs,
    maxKeys: VERIFIED_BEARER_MAX,
    now,
  });
  const protectedPerIp = createCallWindow({
    limit: deps.protectedFirstVerifyPerIp ?? PROTECTED_FIRST_VERIFY_PER_IP,
    windowMs: identityWindowMs,
    now,
  });
  const protectedGlobal = createCallWindow({
    limit: deps.protectedFirstVerifyPerMinute ?? PROTECTED_FIRST_VERIFY_MAX,
    windowMs: identityWindowMs,
    maxKeys: 1,
    now,
  });
  const waiting = createWaitingSet({ maxSize: WAITING_BEARER_MAX, ttlMs: WAITING_BEARER_TTL_MS, now });
  const verifiedBearers = createVerifiedTokenSet({
    ttlMs: VERIFIED_BEARER_TTL_MS,
    maxSize: VERIFIED_BEARER_MAX,
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
    const ip = clientIpFromHeaders(c.req.raw.headers, peerAddress(c));
    const origin = classifyOrigin(c.req.header("origin"), allowedOrigins);
    const authorization = c.req.header("authorization") ?? null;
    let denialHeld = false;
    let bearerHeld = false;
    let identityCharged = false;

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
      spendBearer?: boolean;
    }) => {
      const unauthenticatedOrDenied = !input.identity || input.status === 401 || input.status === 403;
      if (input.recordIp !== false && unauthenticatedOrDenied && input.status !== 429) {
        if (bearerHeld) {
          if (input.spendBearer) bearerHeld = false;
          else {
            bearerBucket.refund();
            bearerHeld = false;
          }
        }
        // A failed take must not occupy a map slot. Record only a token this request already holds or takes now.
        if (denialHeld) {
          denialHeld = false;
          limiter.record(ip);
        } else if (denialBucket.take()) {
          limiter.record(ip);
        }
      }
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

    const tooMany = (retryAfter: number, identity?: { id: string; name: string } | null) =>
      reject({
        status: 429,
        id: null,
        reason: "rate_limited",
        result: "rate_limited",
        recordIp: false,
        identity: identity ? { id: identity.id, name: identity.name, scopes: [] } : null,
        headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfter))) },
        error: { code: JSON_RPC_CLOSED, message: "Rate limit exceeded" },
      });

    // Admit before any await so a concurrent burst cannot all pass a peek and then fill the map.
    // A POST with a supported protocol header and a well-formed bearer is a lookup. A hash that
    // verified recently is limited per identity and skips the shared lookup bucket. An unknown
    // hash that already waited once may verify without that bucket. Every other bearer-shaped
    // call, including a bad protocol header or a GET, uses the denial limiter.
    const presented = bearerToken(authorization);
    const presentedHash = presented ? hashMcpToken(presented) : null;
    const protocolHeader = cleanHeaderValue(c.req.header("mcp-protocol-version"));
    const protocolSupported = protocolHeader != null && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader);
    const authenticating =
      presentedHash != null &&
      c.req.method === "POST" &&
      origin !== "rejected" &&
      protocolSupported &&
      isJsonContentType(c.req.header("content-type"));
    const known = authenticating && presentedHash ? verifiedBearers.get(presentedHash) : null;
    if (authenticating) {
      const saturated = limiter.mapFullRetryAfter(ip);
      if (saturated != null) return tooMany(saturated);
      if (known && !envForcesOff(deps.killSwitchEnv)) {
        const retry = identityCalls.retryAfterSeconds(known.identityId);
        if (retry != null) return tooMany(retry, { id: known.identityId, name: known.identityName });
        identityCalls.record(known.identityId);
        identityCharged = true;
      } else if (!known && presentedHash) {
        // Over the failed-lookup limit: refuse before either lookup bucket.
        const failedRetry = failedLookups.retryAfterSeconds(ip);
        if (failedRetry != null) return tooMany(failedRetry);
        // The wait is per address. A burst of one hash from many addresses
        // does not become a protected retry for every address in the burst.
        const waitKey = `${ip}\n${presentedHash}`;
        const retrying = waiting.has(waitKey);
        const protectedRetry =
          retrying &&
          failedLookups.count(ip) === 0 &&
          protectedPerIp.retryAfterSeconds(ip) == null &&
          protectedGlobal.retryAfterSeconds(PROTECTED_GLOBAL_KEY) == null;
        if (protectedRetry) {
          protectedPerIp.record(ip);
          protectedGlobal.record(PROTECTED_GLOBAL_KEY);
          waiting.forget(waitKey);
        } else {
          const leave = bearerCapacity > 1 && !retrying && waiting.size > 0 ? 1 : 0;
          if (!bearerBucket.take(leave)) {
            waiting.note(waitKey);
            return tooMany(Math.max(1, bearerBucket.retryAfterSeconds()));
          }
          waiting.forget(waitKey);
          bearerHeld = true;
        }
      }
    } else {
      const retryAfter = limiter.retryAfterSeconds(ip);
      if (retryAfter != null) return tooMany(retryAfter);
      if (!denialBucket.take()) return tooMany(denialBucket.retryAfterSeconds());
      denialHeld = true;
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
      decision = await authenticator(authorization);
    } catch {
      decision = { ok: false };
    }
    if (!decision.ok && authenticating && presentedHash) {
      verifiedBearers.forget(presentedHash);
      failedLookups.record(ip);
    }
    if (decision.ok) {
      if (bearerHeld) {
        bearerBucket.refund();
        bearerHeld = false;
      }
      if (denialHeld) {
        denialBucket.refund();
        denialHeld = false;
      }
    }
    const unauthenticated = () =>
      reject({
        status: 401,
        id: request.id,
        reason: "unauthenticated",
        result: "denied",
        spendBearer: true,
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
    if (!identity.id || !identity.name || scopes.length === 0) {
      if (authenticating && presentedHash) {
        verifiedBearers.forget(presentedHash);
        failedLookups.record(ip);
      }
      return unauthenticated();
    }
    if (!identityCharged) identityCalls.record(identity.id);
    if (authenticating && presentedHash) verifiedBearers.remember(presentedHash, { id: identity.id, name: identity.name });
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
    if (request.method === "tools/call" && request.tool === "submit_recommendation") {
      const submitRetry = identitySubmits.retryAfterSeconds(identity.id);
      if (submitRetry != null) return tooMany(submitRetry, identity);
      identitySubmits.record(identity.id);
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
    const unauthenticatedOrDenied = !input.identity || input.result === "denied" || input.result === "rate_limited";
    if (!input.immediate && unauthenticatedOrDenied) {
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
