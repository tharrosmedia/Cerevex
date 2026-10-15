import { createApp, type McpAppDeps } from "../src/app";
import type { McpAuthenticator } from "../src/auth";
import type { SecurityAuditEntry } from "../src/audit";
import type { GuardClient } from "../src/guards";
import type { RemoteKillSwitch } from "../src/kill-switch";
import { PROTOCOL_2025, PROTOCOL_2026 } from "../src/protocol";

export const ALLOWED_ORIGIN = "https://agents.cerevex.test";
export const TOKEN = "super-secret-token-value-xyz";

export function spyGuard(remote: RemoteKillSwitch | string = "clear", audit?: (entry: SecurityAuditEntry) => void) {
  const calls = { kill: 0, audits: [] as SecurityAuditEntry[] };
  const client: GuardClient = {
    async readKillSwitch() {
      calls.kill += 1;
      return remote as RemoteKillSwitch;
    },
    async writeSecurityAudit(entry) {
      calls.audits.push(entry);
      audit?.(entry);
    },
    async verifyToken() {
      return null;
    },
  };
  return { calls, client };
}

export function testApp(
  overrides: Partial<McpAppDeps> & { remote?: RemoteKillSwitch | string; audit?: (entry: SecurityAuditEntry) => void } = {},
) {
  const guard = spyGuard(overrides.remote ?? "clear", overrides.audit);
  const app = createApp({
    allowedOrigins: overrides.allowedOrigins ?? ALLOWED_ORIGIN,
    killSwitchEnv: overrides.killSwitchEnv,
    guards: overrides.guards ?? guard.client,
    authenticator: overrides.authenticator,
    killSwitchTtlMs: overrides.killSwitchTtlMs,
    deniedPerIp: overrides.deniedPerIp,
    deniedWindowMs: overrides.deniedWindowMs,
    deniedFlushMs: overrides.deniedFlushMs,
    deniedMaxIps: overrides.deniedMaxIps,
    globalDenialCapacity: overrides.globalDenialCapacity,
    globalDenialRefillPerSecond: overrides.globalDenialRefillPerSecond,
    globalBearerCapacity: overrides.globalBearerCapacity,
    globalBearerRefillPerSecond: overrides.globalBearerRefillPerSecond,
    now: overrides.now,
    auditControl: overrides.auditControl,
  });
  return { app, guard };
}

export function meta2026(clientName = "ExampleClient", clientVersion = "1.0.0") {
  return {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_2026,
    "io.modelcontextprotocol/clientInfo": { name: clientName, version: clientVersion },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

export function request2026(input: {
  method?: string;
  id?: unknown;
  name?: string;
  arguments?: unknown;
  omitId?: boolean;
  meta?: unknown;
  protocolHeader?: string | null;
  methodHeader?: string | null;
  nameHeader?: string | null;
  origin?: string | null;
  authorization?: string | null;
  contentType?: string;
  extraHeaders?: Record<string, string>;
} = {}) {
  const method = input.method ?? "tools/list";
  const params: Record<string, unknown> = {
    _meta: input.meta === undefined ? meta2026() : input.meta,
  };
  if (input.name !== undefined) params.name = input.name;
  if (input.arguments !== undefined) params.arguments = input.arguments;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (!input.omitId) body.id = input.id === undefined ? 1 : input.id;
  const headers: Record<string, string> = {
    "content-type": input.contentType ?? "application/json",
    ...(input.extraHeaders ?? {}),
  };
  if (input.protocolHeader !== null) {
    headers["mcp-protocol-version"] = input.protocolHeader ?? PROTOCOL_2026;
  }
  if (input.origin !== null) headers.origin = input.origin === undefined ? ALLOWED_ORIGIN : input.origin;
  if (input.methodHeader !== null) headers["mcp-method"] = input.methodHeader === undefined ? method : input.methodHeader;
  if (input.nameHeader) headers["mcp-name"] = input.nameHeader;
  if (input.name && input.nameHeader === undefined && method === "tools/call") headers["mcp-name"] = input.name;
  if (input.authorization != null) headers.authorization = input.authorization;
  return {
    method: "POST" as const,
    headers,
    body: JSON.stringify(body),
  };
}

export function request2025Initialize(origin: string | null = ALLOWED_ORIGIN) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "mcp-protocol-version": PROTOCOL_2025,
  };
  if (origin !== null) headers.origin = origin;
  return {
    method: "POST" as const,
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_2025,
        capabilities: {},
        clientInfo: { name: "LegacyClient", version: "2.0.0" },
      },
    }),
  };
}

export async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

export const acceptingAuthenticator: McpAuthenticator = () => ({
  ok: true,
  identity: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "ping-agent",
    scopes: ["cerevex.read", "cerevex.recs.submit"],
  },
});
