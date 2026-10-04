import { timingSafeEqual } from "node:crypto";
import { compare } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { AuthContext, Role } from "@tharros/ads-shared";
import { SERVICE_ACTOR } from "@tharros/ads-shared/actor";
import { getDb } from "@tharros/ads-shared/db";
import { clientMemberships, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { jwtSecretBytes } from "./jwt-secret";

const SESSION_COOKIE = "tharros_session";

function jwtSecret(): Uint8Array {
  return jwtSecretBytes();
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export async function signSession(userId: string, email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? "7d")
    .sign(jwtSecret());
}

export async function verifySession(token: string): Promise<{ userId: string; email: string }> {
  const { payload } = await jwtVerify(token, jwtSecret());
  if (!payload.sub || typeof payload.email !== "string") {
    throw new Error("Invalid session");
  }
  return { userId: payload.sub, email: payload.email };
}

export async function authenticate(email: string, password: string) {
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  if (!user) return null;
  const ok = await compare(password, user.passwordHash);
  if (!ok) return null;
  return user;
}

export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return null;

  const workspaceRows = await db
    .select({
      workspaceId: memberships.workspaceId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userId, userId));

  const clientRows = await db
    .select({
      clientId: clientMemberships.clientId,
      role: clientMemberships.role,
    })
    .from(clientMemberships)
    .where(eq(clientMemberships.userId, userId));

  return {
    principal: "user",
    user: { id: user.id, email: user.email, name: user.name },
    memberships: workspaceRows.map((row) => ({
      workspaceId: row.workspaceId,
      role: row.role as Role,
    })),
    clientMemberships: clientRows.map((row) => ({
      clientId: row.clientId,
      role: row.role as Role,
    })),
  };
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Header only. A query-string key must not authenticate approve/apply or any other route. */
export function extractInternalKey(header: string | undefined): string | null {
  const value = header?.trim();
  return value ? value : null;
}

/** ADS_INTERNAL_KEY is a service secret (Brain BFF), not a feature flag and not a user. */
export function internalKeyMatches(provided: string | undefined | null): boolean {
  const expected = process.env.ADS_INTERNAL_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isServicePrincipal(auth: AuthContext): boolean {
  return auth.principal === "service" || auth.user == null;
}

/** Audit actor for this request. The service principal never carries a user id. */
export function auditActor(auth: AuthContext): { actorType: "user" | "service"; actorId: string | null } {
  if (isServicePrincipal(auth) || !auth.user) {
    return { actorType: "service", actorId: null };
  }
  return { actorType: "user", actorId: auth.user.id };
}

/** Event payload reference. `service` is not a users.id. */
export function actorRef(auth: AuthContext): string {
  return auth.user?.id ?? SERVICE_ACTOR;
}

const WORKSPACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Configured workspace for the internal key. Never inferred from row order. */
export function internalWorkspaceId(): string | null {
  const value = process.env.ADS_INTERNAL_WORKSPACE_ID?.trim() ?? "";
  return WORKSPACE_UUID.test(value) ? value : null;
}

/**
 * Production refuses to boot when the service key is set and its workspace is not.
 * Other environments fail closed on the request instead of exiting.
 */
export function assertServiceWorkspaceConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.ADS_INTERNAL_KEY?.trim()) return;
  if (!internalWorkspaceId()) {
    throw new Error("ADS_INTERNAL_WORKSPACE_ID must be set when ADS_INTERNAL_KEY is set");
  }
}

/**
 * Internal-key requests run as the service principal for one configured workspace.
 * An unset or unknown workspace id returns null. There is no owner or lowest-id fallback.
 */
export async function loadServiceAuth(): Promise<AuthContext | null> {
  const workspaceId = internalWorkspaceId();
  if (!workspaceId) return null;
  const workspace = await getDb().query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  if (!workspace) return null;
  return {
    principal: "service",
    user: null,
    memberships: [{ workspaceId: workspace.id, role: "operator" satisfies Role }],
    clientMemberships: [],
  };
}

export { and, eq };
