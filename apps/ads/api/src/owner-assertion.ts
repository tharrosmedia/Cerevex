import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { isProductionRuntime } from "@cerevex/contracts";
import {
  ownerAssertionKeyBytes,
  verifyOwnerAssertion,
  type OwnerAssertionRejectReason,
} from "@cerevex/contracts/owner-assertion";
import { getDb } from "@tharros/ads-shared/db";
import { clients, users } from "@tharros/ads-shared/schema";
import { loadAuthContext } from "./auth";
import { childLogger } from "./logger";
import { requireOwnerWorkspace } from "./mcp-identities";
import type { AppEnv } from "./types";

export const OWNER_ASSERTION_JTI_TTL_MS = 90_000;
export const OWNER_ASSERTION_JTI_CAP = 10_000;

/**
 * Process-local single-use jti cache (TTL 90s, cap 10_000).
 * This is fine at one ads-api replica. It must move to a shared store before
 * any ads-api scale-out. A second replica can accept a replay this process
 * already consumed, inside the assertion lifetime.
 */
const seenJti = new Map<string, number>();
const rejectionCounts = new Map<string, number>();

const ASSERTION_SECRET_ENVS = ["CEREVEX_OWNER_ASSERTION_SECRET", "CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS"] as const;
const FORBIDDEN_SECRET_ENVS = ["ADS_INTERNAL_KEY", "MCP_SERVICE_KEY", "JWT_SECRET", "APP_PASSWORD"] as const;
const REPLICA_COUNT_ENVS = ["RAILWAY_REPLICA_COUNT", "RAILWAY_NUM_REPLICAS", "REPLICA_COUNT"] as const;

const OWNER_ONLY = "Only a workspace owner can manage the connector.";
const SIGN_IN = "Sign in required";

export const OWNER_ASSERTION_REPLICA_WARNING =
  "Owner assertion jti cache is in-memory. More than one ads-api replica is configured. Move the jti store to a shared store before scale-out.";

const MISSING_SECRET_WARNING =
  "[auth] CEREVEX_OWNER_ASSERTION_SECRET is missing or short. Owner assertions fail closed with 401. The process will keep running.";
const PREVIOUS_SECRET_WARNING =
  "[auth] CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS is set but unusable. It will not verify owner assertions.";

type AdsAssertionReason =
  | OwnerAssertionRejectReason
  | "replayed"
  | "unknown_user"
  | "not_owner"
  | "multi_owner"
  | "wid_mismatch"
  | "ambiguous";

type AssertionEnv = Record<string, string | undefined>;

export function resetOwnerAssertionForTests(): void {
  seenJti.clear();
  rejectionCounts.clear();
}

export function ownerAssertionEnabled(env: AssertionEnv = process.env): boolean {
  const flag = (env.OWNER_ASSERTION_ENABLED ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * RAILWAY_REPLICA_ID is set on every Railway replica, including a single one,
 * so a non-numeric id is not a count. A numeric id above 0 means this process
 * is not the only replica (id 0 is the first). A replica-count env greater
 * than 1 is an explicit configuration.
 */
export function ownerAssertionReplicaWarning(env: AssertionEnv): string | null {
  let replicas = 1;
  for (const name of REPLICA_COUNT_ENVS) {
    const raw = env[name]?.trim() ?? "";
    if (!/^[0-9]{1,4}$/.test(raw)) continue;
    replicas = Math.max(replicas, Number(raw));
  }
  const id = env.RAILWAY_REPLICA_ID?.trim() ?? "";
  if (/^[0-9]{1,4}$/.test(id)) replicas = Math.max(replicas, Number(id) + 1);
  return replicas > 1 ? OWNER_ASSERTION_REPLICA_WARNING : null;
}

export function warnOwnerAssertionBoot(log: (message: string) => void = console.warn, env: AssertionEnv = process.env): void {
  if (!ownerAssertionKeyBytes(env.CEREVEX_OWNER_ASSERTION_SECRET)) log(MISSING_SECRET_WARNING);
  const previous = env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS;
  if (previous !== undefined && previous.trim() !== "" && !ownerAssertionKeyBytes(previous)) log(PREVIOUS_SECRET_WARNING);
  const replica = ownerAssertionReplicaWarning(env);
  if (replica) log(replica);
}

/** Production boot refuses an assertion secret copied from another credential. Missing secrets only warn. */
export function assertOwnerAssertionSecretsDistinct(env: AssertionEnv = process.env): void {
  if (!isProductionRuntime(env)) return;
  const collision = ownerAssertionSecretCollision(env);
  if (collision) throw new Error(collision);
}

export function ownerAssertionSecretCollision(env: AssertionEnv = process.env): string | null {
  for (const name of ASSERTION_SECRET_ENVS) {
    const value = env[name]?.trim() ?? "";
    if (!value) continue;
    for (const other of FORBIDDEN_SECRET_ENVS) {
      const forbidden = env[other]?.trim() ?? "";
      if (forbidden && value === forbidden) return `${name} must not equal ${other}`;
    }
  }
  return null;
}

/** @returns false when this jti was already used and is still inside the TTL. */
export function rememberOwnerAssertionJti(jti: string, nowMs: number): boolean {
  for (const [key, expiresAt] of seenJti) {
    if (expiresAt <= nowMs) seenJti.delete(key);
  }
  if (seenJti.has(jti)) return false;
  if (seenJti.size >= OWNER_ASSERTION_JTI_CAP) {
    const oldest = seenJti.keys().next().value;
    if (oldest !== undefined) seenJti.delete(oldest);
  }
  seenJti.set(jti, nowMs + OWNER_ASSERTION_JTI_TTL_MS);
  return true;
}

function logRejection(
  log: { warn: (obj: { msg: "owner_assertion.rejected"; reason: AdsAssertionReason; count: number }) => void },
  reason: AdsAssertionReason,
): void {
  const count = (rejectionCounts.get(reason) ?? 0) + 1;
  rejectionCounts.set(reason, count);
  log.warn({ msg: "owner_assertion.rejected", reason, count });
}

function requestTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * When the flag is on and the assertion header is present, this either sets a
 * user principal or throws 401/403. The flag off ignores the header. There is
 * no static-token fallback.
 * @returns true when the assertion authenticated the request.
 */
export async function authenticateOwnerAssertion(c: Context<AppEnv>): Promise<boolean> {
  if (!ownerAssertionEnabled()) return false;
  const assertion = c.req.header("x-cerevex-owner-assertion")?.trim() ?? "";
  if (!assertion) return false;

  const log = childLogger(c.get("requestId"));
  const internalKey = c.req.header("x-cerevex-internal-key")?.trim() ?? "";
  if (internalKey) {
    logRejection(log, "ambiguous");
    throw new HTTPException(401, { message: SIGN_IN });
  }

  const current = process.env.CEREVEX_OWNER_ASSERTION_SECRET;
  if (ownerAssertionSecretCollision() || !ownerAssertionKeyBytes(current)) {
    logRejection(log, "missing_secret");
    throw new HTTPException(401, { message: SIGN_IN });
  }

  const result = verifyOwnerAssertion(assertion, {
    current,
    previous: process.env.CEREVEX_OWNER_ASSERTION_SECRET_PREVIOUS,
    htm: c.req.method,
    htu: requestTarget(c.req.url),
  });
  if (!result.ok) {
    logRejection(log, result.reason);
    throw new HTTPException(401, { message: SIGN_IN });
  }
  if (!rememberOwnerAssertionJti(result.claims.jti, Date.now())) {
    logRejection(log, "replayed");
    throw new HTTPException(401, { message: SIGN_IN });
  }

  const user = await getDb().query.users.findFirst({ where: eq(users.email, result.claims.sub) });
  if (!user) {
    logRejection(log, "unknown_user");
    throw new HTTPException(401, { message: SIGN_IN });
  }
  const auth = await loadAuthContext(user.id);
  if (!auth?.user) {
    logRejection(log, "unknown_user");
    throw new HTTPException(401, { message: SIGN_IN });
  }

  let gate: { workspaceId: string; userId: string };
  try {
    gate = requireOwnerWorkspace(auth);
  } catch (error) {
    if (error instanceof HTTPException) {
      const owners = auth.memberships.filter((row) => row.role === "owner");
      logRejection(log, owners.length > 1 ? "multi_owner" : "not_owner");
    }
    throw error;
  }
  if (gate.workspaceId !== result.claims.wid) {
    logRejection(log, "wid_mismatch");
    throw new HTTPException(403, { message: OWNER_ONLY });
  }

  const wid = result.claims.wid;
  const inWorkspace = await getDb().select({ id: clients.id }).from(clients).where(eq(clients.workspaceId, wid));
  const allowedClientIds = new Set(inWorkspace.map((row) => row.id));
  log.info({ msg: "owner_assertion.accepted" });
  c.set("auth", {
    principal: "user",
    user: auth.user,
    memberships: [{ workspaceId: wid, role: "owner" }],
    clientMemberships: auth.clientMemberships.filter((row) => allowedClientIds.has(row.clientId)),
  });
  return true;
}
