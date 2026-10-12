import { adsCallerHeaders } from "../src/lib/db/workspace-ads-sync";
import { isProductionRuntime } from "./runtime-env";

export type AdsFailReason = "not_configured" | "unreachable" | "unauthorized" | "not_found" | "error";

export type AdsResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; reason: AdsFailReason; message: string; status: number; data?: unknown };

export type AdsClient = {
  id: string;
  workspaceId: string;
  name: string;
  pilotFlag?: boolean;
  status?: string;
  siteId?: string | null;
  createdAt?: string;
  connectedPlatforms?: Array<"meta" | "google">;
  lastSyncAt?: string | null;
};

export type AdsAccount = {
  id: string;
  workspaceId: string;
  clientId: string;
  platform: "meta" | "google";
  externalId: string;
  displayName?: string | null;
  connectionStatus: string;
  lastSyncAt: string | null;
  lastError: string | null;
  hasCredentials: boolean;
  mock: boolean;
  frozen?: boolean;
};

export type AdsAudit = {
  id: string;
  workspaceId: string;
  clientId: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
};

export type AdsFinding = {
  id: string;
  workspaceId: string;
  clientId: string | null;
  auditRunId: string | null;
  severity: string;
  title: string;
  body: Record<string, unknown>;
  createdAt: string;
};

export type AdsSuggestion = {
  id: string;
  workspaceId: string;
  clientId: string;
  adAccountId: string;
  type: string;
  title: string;
  rationale: string;
  estimatedImpactUsd: string | null;
  risk: string;
  confidence: string | null;
  evidence: Record<string, unknown>;
  proposedMutations: unknown[];
  status: string;
  schemaVersion?: string;
  createdAt: string;
};

export type AdsWorkspace = {
  id: string;
  name: string;
  applyKillSwitch: boolean;
  capabilities?: import('@cerevex/contracts').CapabilityFlags;
};

function adsApiUrl(): string {
  const fromEnv = process.env.ADS_API_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (isProductionRuntime()) return "";
  return "http://127.0.0.1:43180";
}

export function adsApiConfigured(): boolean {
  return Boolean(adsApiUrl());
}

export type AdsCallOptions = {
  anonymous?: boolean;
  /** Owner bearer token only. The service key is not a workspace owner. */
  asOwner?: boolean;
};

const ADS_API_TIMEOUT_MS = 8_000;

function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function adsApi<T>(
  path: string,
  init: RequestInit = {},
  options: AdsCallOptions = {},
): Promise<AdsResult<T>> {
  const base = adsApiUrl();
  if (!base) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Ads checks are not connected yet.",
      status: 503,
    };
  }

  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  // Service secrets only — not product flags. APP_PASSWORD is Brain console session.
  // The default call uses the service key. asOwner sends the owner token alone
  // for writes ads-api refuses from the service principal. Pause stays on the default.
  headers.delete("x-cerevex-internal-key");
  headers.delete("authorization");
  if (!options.anonymous) {
    const caller = options.asOwner
      ? adsCallerHeaders({
          safetyOn: true,
          internalKey: null,
          ownerToken: process.env.ADS_API_TOKEN,
        })
      : adsCallerHeaders({
          safetyOn: false,
          internalKey: process.env.ADS_INTERNAL_KEY,
          ownerToken: process.env.ADS_API_TOKEN,
        });
    const internalKey = caller.get("x-cerevex-internal-key");
    const authorization = caller.get("authorization");
    if (internalKey) headers.set("x-cerevex-internal-key", internalKey);
    if (authorization) headers.set("authorization", authorization);
  }

  const suffix = path.startsWith("/") ? path : `/${path}`;
  try {
    const res = await fetch(`${base}${suffix}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(ADS_API_TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const body = jsonObject(parsed) ? (parsed as { error?: string } & T) : null;
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "unauthorized",
        message: body?.error ?? "Ads module is not authorized.",
        status: res.status,
        data: body,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: body?.error ?? "Not found.",
        status: 404,
        data: body,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "error",
        message: body?.error ?? `Ads request failed (${res.status})`,
        status: res.status,
        data: body,
      };
    }
    if (!body) {
      return {
        ok: false,
        reason: "error",
        message: "Ads response was not JSON.",
        status: res.status,
        data: null,
      };
    }
    return { ok: true, data: body, status: res.status };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach the ads service.",
      status: 503,
    };
  }
}

export async function loadAdsCockpit() {
  const [workspace, clients, audits, suggestions] = await Promise.all([
    adsApi<{ workspace: AdsWorkspace | null }>("/workspace"),
    adsApi<{ clients: AdsClient[] }>("/clients"),
    adsApi<{ audits: AdsAudit[] }>("/audits"),
    adsApi<{ recommendations: AdsSuggestion[] }>("/recommendations"),
  ]);

  if (!clients.ok) {
    return {
      ok: false as const,
      reason: clients.reason,
      message: clients.message,
      workspace: workspace.ok ? workspace.data.workspace : null,
      clients: [] as AdsClient[],
      audits: [] as AdsAudit[],
      suggestions: [] as AdsSuggestion[],
    };
  }

  return {
    ok: true as const,
    reason: null,
    message: "",
    workspace: workspace.ok ? workspace.data.workspace : null,
    clients: clients.data.clients,
    audits: audits.ok ? audits.data.audits : [],
    suggestions: suggestions.ok ? suggestions.data.recommendations : [],
  };
}

/**
 * The ads client that owns this site's ad accounts.
 * Add, rename, and link refuse the service key, so these calls send the owner token alone.
 */
export function ensureSiteClient(siteId: string, name: string) {
  return adsApi<{ client: AdsClient; created: boolean; adopted: boolean }>(
    `/sites/${encodeURIComponent(siteId)}/client`,
    { method: "PUT", body: JSON.stringify({ name }) },
    { asOwner: true },
  );
}

export function listAdsClients() {
  return adsApi<{ clients: AdsClient[] }>("/clients", {}, { asOwner: true });
}

export function renameAdsClient(clientId: string, name: string) {
  return adsApi<{ client: AdsClient }>(
    `/clients/${encodeURIComponent(clientId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
    { asOwner: true },
  );
}

export type ClientSetupSummary = {
  name: string;
  accounts: {
    meta: Array<{ externalId: string; displayName: string | null; status: string }>;
    google: Array<{ externalId: string; displayName: string | null; status: string }>;
  };
  callrail: { present: boolean };
  skills: {
    slug: string | null;
    loaded: boolean;
    linked: boolean;
    missingFacts: number;
  };
};

/** Read-only setup summary. Website, business type, Search Console, and GA4 stay in Brain. */
export function getClientSetup(clientId: string) {
  return adsApi<ClientSetupSummary>(`/clients/${encodeURIComponent(clientId)}/setup`);
}

export function linkAdsClientSite(clientId: string, siteId: string | null) {
  return adsApi<{ client: AdsClient }>(
    `/clients/${encodeURIComponent(clientId)}/site`,
    { method: "POST", body: JSON.stringify({ siteId }) },
    { asOwner: true },
  );
}

export function connectedPlatforms(clients: AdsClient[]): Array<"meta" | "google"> {
  const set = new Set<"meta" | "google">();
  for (const client of clients) {
    for (const platform of client.connectedPlatforms ?? []) set.add(platform);
  }
  return [...set];
}
