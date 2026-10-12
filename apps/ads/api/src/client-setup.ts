import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadWorkspaceSettings } from "@tharros/ads-shared/connector-settings";
import { getDb } from "@tharros/ads-shared/db";
import { adAccounts, locations, skillClientConfigs, skillStoreConfigs } from "@tharros/ads-shared/schema";
import { publicConnectionStatus } from "./connect";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Connection states from the Meta connect brief (H1). Today's rows use the
 * subset publicConnectionStatus already returns, including pending. A later
 * H1 contracts type can replace this list without a migration.
 */
export const SETUP_ACCOUNT_STATUSES = [
  "connected",
  "syncing",
  "needs_reconnect",
  "expiring",
  "limited",
  "error",
  "rate_limited",
  "not_configured",
  "pending",
  "disconnected",
] as const;

export type SetupAccountStatus = (typeof SETUP_ACCOUNT_STATUSES)[number];

export type SetupAccount = {
  id: string;
  externalId: string;
  displayName: string | null;
  status: string;
};

export type ClientSetup = {
  clientId: string;
  name: string;
  plan: string;
  checklist: Array<{ id: "site" | "meta" | "google" | "callrail" | "skills"; status: string }>;
  site: { status: "linked" | "missing"; siteId: string | null };
  accounts: { meta: SetupAccount[]; google: SetupAccount[] };
  callrail: { present: boolean };
  skills: {
    slug: string | null;
    loaded: boolean;
    linked: boolean;
    missingFacts: number;
  };
  locations: Array<{ id: string; storeId: string }>;
};

function rollupStatus(statuses: string[]): string {
  if (statuses.length === 0) return "disconnected";
  for (const status of SETUP_ACCOUNT_STATUSES) {
    if (statuses.includes(status)) return status;
  }
  return statuses[0] ?? "disconnected";
}

function missingFactCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Read-only setup summary for one client. Website, business type, Search
 * Console, and GA4 stay on Brain. This route reports the ads-side checklist.
 */
export async function readClientSetup(
  auth: AppEnv["Variables"]["auth"],
  clientId: string,
): Promise<ClientSetup> {
  if (!CLIENT_ID.test(clientId)) {
    throw new HTTPException(404, { message: "Client not found" });
  }
  const client = await getVisibleClient(auth, clientId);
  if (!client) throw new HTTPException(404, { message: "Client not found" });

  const db = getDb();
  const accountRows = await db.select().from(adAccounts).where(eq(adAccounts.clientId, client.id));
  const toAccount = (row: (typeof accountRows)[number]): SetupAccount => ({
    id: row.id,
    externalId: row.externalId,
    displayName: row.displayName ?? null,
    status: publicConnectionStatus(row),
  });
  const meta = accountRows.filter((row) => row.platform === "meta").map(toAccount);
  const google = accountRows.filter((row) => row.platform === "google").map(toAccount);

  const { connectors } = await loadWorkspaceSettings(client.workspaceId);
  const callrail = connectors.callrail[client.id];
  const callrailPresent = Boolean(callrail?.encryptedApiKey || callrail?.usesEnv || callrail?.connected);

  const profiles = await db
    .select()
    .from(skillClientConfigs)
    .where(eq(skillClientConfigs.clientId, client.id));
  const profile = profiles[0] ?? null;
  const stores = profile
    ? await db.select().from(skillStoreConfigs).where(eq(skillStoreConfigs.clientSlug, profile.slug))
    : [];
  const siteId = client.siteId?.trim() ? client.siteId : null;
  const loaded = Boolean(profile);
  const linked = Boolean(siteId && stores.some((store) => store.brainStoreId === siteId));

  const activeLocations = await db
    .select({ id: locations.id, storeId: locations.storeId })
    .from(locations)
    .where(and(eq(locations.clientId, client.id), eq(locations.status, "active")));

  const siteStatus = siteId ? "linked" : "missing";
  const metaStatus = rollupStatus(meta.map((row) => row.status));
  const googleStatus = rollupStatus(google.map((row) => row.status));
  const callrailStatus = callrailPresent ? "present" : "missing";
  const skillsStatus = linked ? "linked" : loaded ? "loaded" : "missing";

  return {
    clientId: client.id,
    name: client.name,
    plan: client.plan,
    checklist: [
      { id: "site", status: siteStatus },
      { id: "meta", status: metaStatus },
      { id: "google", status: googleStatus },
      { id: "callrail", status: callrailStatus },
      { id: "skills", status: skillsStatus },
    ],
    site: { status: siteStatus, siteId },
    accounts: { meta, google },
    callrail: { present: callrailPresent },
    skills: {
      slug: profile?.slug ?? null,
      loaded,
      linked,
      missingFacts: missingFactCount(profile?.missingFactsJson),
    },
    locations: activeLocations,
  };
}

export function registerClientSetupRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/clients/:id/setup", requireAuth, async (c) => {
    const setup = await readClientSetup(c.get("auth"), c.req.param("id"));
    return c.json(setup);
  });
}
