export type AdsFailReason = "not_configured" | "unreachable" | "unauthorized" | "not_found" | "error";

export type AdsResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; reason: AdsFailReason; message: string; status: number };

export type AdsClient = {
  id: string;
  workspaceId: string;
  name: string;
  pilotFlag?: boolean;
  status?: string;
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
  connectionStatus: string;
  lastSyncAt: string | null;
  lastError: string | null;
  hasCredentials: boolean;
  mock: boolean;
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
};

function adsApiUrl(): string {
  const fromEnv = process.env.ADS_API_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return "";
  return "http://127.0.0.1:43180";
}

export function adsApiConfigured(): boolean {
  return Boolean(adsApiUrl());
}

export async function adsApi<T>(path: string, init: RequestInit = {}): Promise<AdsResult<T>> {
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
  const internalKey = process.env.ADS_INTERNAL_KEY;
  const token = process.env.ADS_API_TOKEN;
  if (internalKey) headers.set("x-cerevex-internal-key", internalKey);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const suffix = path.startsWith("/") ? path : `/${path}`;
  try {
    const res = await fetch(`${base}${suffix}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "unauthorized",
        message: body.error ?? "Ads module is not authorized.",
        status: res.status,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: body.error ?? "Not found.",
        status: 404,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "error",
        message: body.error ?? `Ads request failed (${res.status})`,
        status: res.status,
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

export function connectedPlatforms(clients: AdsClient[]): Array<"meta" | "google"> {
  const set = new Set<"meta" | "google">();
  for (const client of clients) {
    for (const platform of client.connectedPlatforms ?? []) set.add(platform);
  }
  return [...set];
}
