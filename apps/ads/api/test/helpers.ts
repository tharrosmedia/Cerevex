import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "@tharros/ads-shared";
import { getDb } from "@tharros/ads-shared/db";

loadEnv();
import { clientMemberships, clients, memberships, users, workspaces } from "@tharros/ads-shared/schema";
import { createApp } from "../src/app";

export const app = createApp();

export async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

export async function ensureScopedUser() {
  const db = getDb();
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.name, "Tharros Media"),
  });
  if (!workspace) throw new Error("Seed workspace missing. Run npm run ads:db:seed first.");
  const allClients = await db.select().from(clients).where(eq(clients.workspaceId, workspace.id));
  const gotDuctless = allClients.find((c) => c.name === "Got Ductless");
  if (!gotDuctless) throw new Error("Seed pilots missing.");

  const email = "pilot.readonly@tharrosmedia.com";
  const passwordHash = await hash("readonly-local-only", 10);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  const user =
    existing ??
    (
      await db
        .insert(users)
        .values({ email, name: "Got Ductless Read-only", passwordHash })
        .returning()
    )[0];
  if (existing) {
    await db.update(users).set({ passwordHash }).where(and(eq(users.id, user.id)));
  }
  await db
    .insert(memberships)
    .values({ userId: user.id, workspaceId: workspace.id, role: "client_readonly" })
    .onConflictDoNothing();
  await db
    .insert(clientMemberships)
    .values({ userId: user.id, clientId: gotDuctless.id, role: "client_readonly" })
    .onConflictDoNothing();
  return { workspace, gotDuctless };
}

export async function login(email: string, password: string) {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await json(res);
  return { status: res.status, token: String(body.token ?? "") };
}
