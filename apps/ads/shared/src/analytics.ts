import { and, desc, eq, gte } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getAnalyticsConnector } from "./connectors";
import { getDb } from "./db";
import { inferPlatformFromClick, summarizeFunnel, type FunnelEventView, type FunnelSignal } from "./funnel";
import { analyticsConnections, funnelEvents } from "./schema";

export type AnalyticsConnectionPublic = {
  id: string;
  connectorId: string;
  status: string;
  label: string;
  pixelToken: string | null;
  settings: Record<string, unknown>;
  lastError: string | null;
  connectedAt: string | null;
};

function newPixelToken(): string {
  return randomBytes(18).toString("hex");
}

export function toAnalyticsConnectionPublic(
  row: typeof analyticsConnections.$inferSelect,
): AnalyticsConnectionPublic {
  return {
    id: row.id,
    connectorId: row.connectorId,
    status: row.status,
    label: row.label,
    pixelToken: row.pixelToken,
    settings: (row.settingsJson as Record<string, unknown>) ?? {},
    lastError: row.lastError,
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
  };
}

export async function listAnalyticsConnections(workspaceId: string, clientId?: string | null) {
  const db = getDb();
  const rows = await db.select().from(analyticsConnections).where(eq(analyticsConnections.workspaceId, workspaceId));
  return rows
    .filter((row) => !clientId || row.clientId == null || row.clientId === clientId)
    .map(toAnalyticsConnectionPublic);
}

export async function upsertAnalyticsConnection(input: {
  workspaceId: string;
  clientId?: string | null;
  connectorId: "ga4" | "first_party";
  label?: string;
  settings?: Record<string, unknown>;
}): Promise<AnalyticsConnectionPublic> {
  const connector = getAnalyticsConnector(input.connectorId);
  const connected = await connector.connect({
    workspaceId: input.workspaceId,
    clientId: input.clientId ?? undefined,
    label: input.label,
    externalId:
      input.connectorId === "ga4"
        ? String(input.settings?.propertyId ?? input.settings?.measurementId ?? "")
        : undefined,
  });
  if (!connected.ok) {
    throw new Error(connected.reason ?? "Could not connect that funnel source.");
  }

  const db = getDb();
  const existing = (
    await db
      .select()
      .from(analyticsConnections)
      .where(
        and(
          eq(analyticsConnections.workspaceId, input.workspaceId),
          eq(analyticsConnections.connectorId, input.connectorId),
          input.clientId
            ? eq(analyticsConnections.clientId, input.clientId)
            : eq(analyticsConnections.workspaceId, input.workspaceId),
        ),
      )
  ).find((row) => (input.clientId ? row.clientId === input.clientId : row.clientId == null));

  const pixelToken = existing?.pixelToken ?? (input.connectorId === "first_party" ? newPixelToken() : null);
  const values = {
    workspaceId: input.workspaceId,
    clientId: input.clientId ?? null,
    connectorId: input.connectorId,
    status: "connected",
    label: input.label ?? connector.label,
    pixelToken,
    settingsJson: input.settings ?? {},
    lastError: null,
    connectedAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(analyticsConnections)
      .set(values)
      .where(eq(analyticsConnections.id, existing.id))
      .returning();
    return toAnalyticsConnectionPublic(row);
  }
  const [row] = await db.insert(analyticsConnections).values(values).returning();
  return toAnalyticsConnectionPublic(row);
}

export async function disconnectAnalyticsConnection(id: string, workspaceId: string) {
  const db = getDb();
  const row = await db.query.analyticsConnections.findFirst({
    where: and(eq(analyticsConnections.id, id), eq(analyticsConnections.workspaceId, workspaceId)),
  });
  if (!row) return null;
  await getAnalyticsConnector(row.connectorId as "ga4" | "first_party").disconnect({
    workspaceId,
    clientId: row.clientId ?? undefined,
  });
  const [updated] = await db
    .update(analyticsConnections)
    .set({ status: "disconnected", lastError: null, updatedAt: new Date() })
    .where(eq(analyticsConnections.id, id))
    .returning();
  return toAnalyticsConnectionPublic(updated);
}

export async function findConnectionByPixelToken(token: string) {
  const rows = await getDb().select().from(analyticsConnections).where(eq(analyticsConnections.pixelToken, token)).limit(1);
  return rows[0] ?? null;
}

export async function recordFunnelEvent(input: {
  token?: string;
  workspaceId?: string;
  connectionId?: string;
  name: string;
  url?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  properties?: Record<string, unknown>;
  source?: string;
}) {
  const db = getDb();
  let connection = input.connectionId
    ? await db.query.analyticsConnections.findFirst({ where: eq(analyticsConnections.id, input.connectionId) })
    : null;
  if (!connection && input.token) {
    connection = await findConnectionByPixelToken(input.token);
  }
  if (!connection && !input.workspaceId) {
    throw new Error("Unknown pixel token.");
  }
  const workspaceId = connection?.workspaceId ?? input.workspaceId!;
  const platform = inferPlatformFromClick({
    gclid: input.gclid,
    fbclid: input.fbclid,
    utmSource: input.utmSource,
  });
  const [row] = await db
    .insert(funnelEvents)
    .values({
      workspaceId,
      clientId: connection?.clientId ?? null,
      connectionId: connection?.id ?? null,
      name: input.name,
      source: input.source ?? "first_party",
      url: input.url ?? null,
      referrer: input.referrer ?? null,
      platform,
      campaign: input.utmCampaign ?? null,
      clickId: input.gclid ?? input.fbclid ?? null,
      propertiesJson: input.properties ?? {},
      occurredAt: new Date(),
    })
    .returning();
  return row;
}

export async function loadFunnelSignal(workspaceId: string, clientId?: string | null): Promise<FunnelSignal> {
  const db = getDb();
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
  const rows = await db
    .select()
    .from(funnelEvents)
    .where(and(eq(funnelEvents.workspaceId, workspaceId), gte(funnelEvents.occurredAt, since)))
    .orderBy(desc(funnelEvents.occurredAt))
    .limit(2000);
  const scoped = rows.filter((row) => !clientId || row.clientId == null || row.clientId === clientId);
  const events: FunnelEventView[] = scoped.map((row) => ({
    name: row.name,
    source: row.source,
    platform: row.platform,
    campaign: row.campaign,
    url: row.url,
  }));
  const connections = await listAnalyticsConnections(workspaceId, clientId);
  const ga4Connected = connections.some((row) => row.connectorId === "ga4" && row.status === "connected");
  return summarizeFunnel(events, ga4Connected);
}

export function pixelScript(collectUrl: string, token: string): string {
  return `(function(){var t=${JSON.stringify(token)};var u=${JSON.stringify(collectUrl)};function send(n,d){try{var body=JSON.stringify(Object.assign({token:t,name:n,url:location.href,referrer:document.referrer,utmSource:(new URLSearchParams(location.search)).get("utm_source"),utmCampaign:(new URLSearchParams(location.search)).get("utm_campaign"),gclid:(new URLSearchParams(location.search)).get("gclid"),fbclid:(new URLSearchParams(location.search)).get("fbclid")},d||{}));if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([body],{type:"application/json"}));}else{fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:body,keepalive:true,mode:"no-cors"});}}catch(e){}}send("page_view");window.cerevex=window.cerevex||{track:send};})();`;
}
