import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "@tharros/shared";
import { closeDb, getDb } from "@tharros/shared/db";
import { clientMemberships, clients, memberships, users, workspaces } from "@tharros/shared/schema";
import { createApp } from "../src/app";

loadEnv();

const app = createApp();

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("tenancy isolation", () => {
  const scopedEmail = "pilot.readonly@tharrosmedia.com";
  let scopedToken = "";
  let ownerToken = "";
  let gotDuctlessId = "";
  let otherClientId = "";

  beforeAll(async () => {
    const db = getDb();
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.name, "Tharros Media"),
    });
    if (!workspace) {
      throw new Error("Seed workspace missing. Run pnpm db:seed first.");
    }

    const allClients = await db
      .select()
      .from(clients)
      .where(eq(clients.workspaceId, workspace.id));
    const gotDuctless = allClients.find((c) => c.name === "Got Ductless");
    const other = allClients.find((c) => c.name === "KC Prestige");
    if (!gotDuctless || !other) {
      throw new Error("Seed pilots missing. Run pnpm db:seed first.");
    }
    gotDuctlessId = gotDuctless.id;
    otherClientId = other.id;

    const passwordHash = await hash("readonly-local-only", 10);
    const existing = await db.query.users.findFirst({
      where: eq(users.email, scopedEmail),
    });
    const scopedUser =
      existing ??
      (
        await db
          .insert(users)
          .values({
            email: scopedEmail,
            name: "Got Ductless Read-only",
            passwordHash,
          })
          .returning()
      )[0];

    if (!existing) {
      await db.insert(memberships).values({
        userId: scopedUser.id,
        workspaceId: workspace.id,
        role: "client_readonly",
      });
      await db.insert(clientMemberships).values({
        userId: scopedUser.id,
        clientId: gotDuctless.id,
        role: "client_readonly",
      });
    } else {
      await db
        .insert(memberships)
        .values({
          userId: scopedUser.id,
          workspaceId: workspace.id,
          role: "client_readonly",
        })
        .onConflictDoNothing();
      await db
        .insert(clientMemberships)
        .values({
          userId: scopedUser.id,
          clientId: gotDuctless.id,
          role: "client_readonly",
        })
        .onConflictDoNothing();
      await db
        .update(users)
        .set({ passwordHash })
        .where(and(eq(users.id, scopedUser.id)));
    }

    const ownerLogin = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        password: process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      }),
    });
    expect(ownerLogin.status).toBe(200);
    ownerToken = String((await json(ownerLogin)).token);

    const scopedLogin = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: scopedEmail,
        password: "readonly-local-only",
      }),
    });
    expect(scopedLogin.status).toBe(200);
    scopedToken = String((await json(scopedLogin)).token);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("lets the workspace owner see all three HVAC pilots", async () => {
    const res = await app.request("/clients", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    const names = (body.clients as { name: string }[]).map((c) => c.name).sort();
    expect(names).toEqual(["Elmar HVAC", "Got Ductless", "KC Prestige"]);
  });

  it("does not let a client_readonly user list another client's row", async () => {
    const res = await app.request("/clients", {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    const rows = body.clients as { id: string; name: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Got Ductless");
    expect(rows[0]?.id).toBe(gotDuctlessId);
    expect(rows.some((row) => row.id === otherClientId)).toBe(false);
  });

  it("returns 404 rather than leaking KC Prestige to a Got Ductless-scoped user", async () => {
    const allowed = await app.request(`/clients/${gotDuctlessId}`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(allowed.status).toBe(200);

    const leaked = await app.request(`/clients/${otherClientId}`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(leaked.status).toBe(404);
    const body = await json(leaked);
    expect(body).not.toHaveProperty("client");
    expect(String(body.error)).toMatch(/not found/i);
  });
});
