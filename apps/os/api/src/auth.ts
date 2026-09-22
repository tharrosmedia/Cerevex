import { compare } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { AuthContext, Role } from "@tharros/shared";
import { getDb } from "@tharros/shared/db";
import { clientMemberships, memberships, users } from "@tharros/shared/schema";

const SESSION_COOKIE = "tharros_session";

function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "replace-with-a-long-random-local-secret";
  return new TextEncoder().encode(secret);
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

export { and, eq };
