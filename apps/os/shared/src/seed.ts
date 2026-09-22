import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "./db";
import { loadEnv } from "./env";
import { auditLog, clients, memberships, users, workspaces } from "./schema";

const PILOT_CLIENTS = ["Got Ductless", "KC Prestige", "Elmar HVAC"] as const;

async function main(): Promise<void> {
  loadEnv();
  const db = getDb();

  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com").toLowerCase();
  const ownerName = process.env.SEED_OWNER_NAME ?? "Adam";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "local-dev-only";

  const existingNamed = await db.query.workspaces.findFirst({
    where: eq(workspaces.name, "Tharros Media"),
  });

  const [workspace] = existingNamed
    ? [existingNamed]
    : await db
        .insert(workspaces)
        .values({
          name: "Tharros Media",
          settingsJson: { vertical: "hvac", stage: "m1-spine" },
          applyKillSwitch: true,
        })
        .returning();

  const existingWorkspace = workspace;

  if (!existingWorkspace) {
    throw new Error("Failed to create or load workspace Tharros Media");
  }

  const passwordHash = await hash(ownerPassword, 12);
  const [insertedUser] = await db
    .insert(users)
    .values({
      email: ownerEmail,
      name: ownerName,
      passwordHash,
    })
    .onConflictDoNothing()
    .returning();

  const owner =
    insertedUser ??
    (await db.query.users.findFirst({
      where: eq(users.email, ownerEmail),
    }));

  if (!owner) {
    throw new Error(`Failed to create or load owner ${ownerEmail}`);
  }

  if (!insertedUser) {
    await db.update(users).set({ name: ownerName, passwordHash }).where(eq(users.id, owner.id));
  }

  await db
    .insert(memberships)
    .values({
      userId: owner.id,
      workspaceId: existingWorkspace.id,
      role: "owner",
    })
    .onConflictDoNothing();

  const seededClients = [];
  for (const name of PILOT_CLIENTS) {
    const [inserted] = await db
      .insert(clients)
      .values({
        workspaceId: existingWorkspace.id,
        name,
        pilotFlag: true,
        status: "active",
      })
      .onConflictDoNothing()
      .returning();

    const client =
      inserted ??
      (await db.query.clients.findFirst({
        where: and(eq(clients.workspaceId, existingWorkspace.id), eq(clients.name, name)),
      }));

    if (!client) {
      throw new Error(`Failed to seed client ${name}`);
    }
    seededClients.push(client);
  }

  await db.insert(auditLog).values({
    workspaceId: existingWorkspace.id,
    actorType: "system",
    actorId: owner.id,
    action: "seed.m1_spine",
    entityType: "workspace",
    entityId: existingWorkspace.id,
    payloadJson: {
      clients: seededClients.map((c) => c.name),
      ownerEmail,
    },
  });

  console.log(
    JSON.stringify(
      {
        workspace: existingWorkspace.name,
        owner: ownerEmail,
        clients: seededClients.map((c) => ({ id: c.id, name: c.name, pilotFlag: c.pilotFlag })),
        applyKillSwitch: existingWorkspace.applyKillSwitch,
      },
      null,
      2,
    ),
  );

  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
