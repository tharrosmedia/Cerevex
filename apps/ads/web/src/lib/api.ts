import type {
  AdAccountPublic,
  AdEntityPublic,
  AuditRunPublic,
  BusinessType,
  ClientSummary,
  SessionUser,
  Membership,
  ClientMembership,
  FindingPublic,
  CapabilityOverrides,
  ModuleFlags,
  OAuthPlatformConfig,
  Platform,
  RecommendationPublic,
  AuthorizationPublic,
  WorkspaceSummary,
} from "@tharros/ads-shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:43180";
const TOKEN_KEY = "tharros_token";

export function apiUrl(): string {
  return API_URL;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  return body;
}

export type ApplyJobPublic = {
  id: string;
  workspaceId: string;
  clientId: string;
  authorizationId: string;
  status: string;
  attempts: number;
  error: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
};

export type MeResponse = {
  user: SessionUser;
  memberships: Membership[];
  clientMemberships: ClientMembership[];
  canApprove?: boolean;
};

export type LoginResponse = MeResponse & { token: string };

export type ClientsResponse = { clients: ClientSummary[] };
export type ClientResponse = {
  client: ClientSummary;
  adAccounts: AdAccountPublic[];
  oauth: { meta: OAuthPlatformConfig; google: OAuthPlatformConfig };
  canManage: boolean;
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const result = await api<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(result.token);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    setToken(null);
  }
}

export async function me(): Promise<MeResponse> {
  return api<MeResponse>("/auth/me");
}

export async function listClients(): Promise<ClientSummary[]> {
  const result = await api<ClientsResponse>("/clients");
  return result.clients;
}

export async function getClient(id: string): Promise<ClientResponse> {
  return api<ClientResponse>(`/clients/${id}`);
}

export async function mockConnect(clientId: string, platform: Platform): Promise<AdAccountPublic> {
  const result = await api<{ adAccount: AdAccountPublic }>("/oauth/mock/connect", {
    method: "POST",
    body: JSON.stringify({ clientId, platform }),
  });
  return result.adAccount;
}

export async function startOAuth(clientId: string, platform: Platform): Promise<string> {
  const result = await api<{ url: string }>(`/oauth/${platform}/start?clientId=${clientId}`);
  return result.url;
}

export async function syncAdAccount(adAccountId: string): Promise<{ jobId: string }> {
  return api(`/ad-accounts/${adAccountId}/sync`, { method: "POST" });
}

export async function getAdAccount(adAccountId: string): Promise<{
  adAccount: AdAccountPublic;
  entities: AdEntityPublic[];
}> {
  return api(`/ad-accounts/${adAccountId}`);
}

export async function enqueueStubJob(note?: string, clientId?: string): Promise<{ jobId: string }> {
  return api("/jobs/stub", {
    method: "POST",
    body: JSON.stringify({ note, clientId }),
  });
}

export type AuditBundleResponse = {
  audit: AuditRunPublic;
  findings: FindingPublic[];
  recommendations: RecommendationPublic[];
  writes: false;
  inline?: boolean;
  name?: string;
  status?: string;
};

export async function getWorkspace(): Promise<{
  workspace: WorkspaceSummary | null;
  canMutate: boolean;
  canApprove?: boolean;
}> {
  return api("/workspace");
}

export async function patchWorkspace(input: {
  businessType?: BusinessType;
  modules?: Partial<ModuleFlags>;
  capabilities?: CapabilityOverrides;
  applyKillSwitch?: boolean;
}): Promise<{ workspace: WorkspaceSummary | null; canMutate: boolean; canApprove?: boolean }> {
  return api("/workspace", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function startInlineAudit(clientId: string, adAccountId?: string): Promise<AuditBundleResponse> {
  return api(`/clients/${clientId}/audits`, {
    method: "POST",
    body: JSON.stringify({ inline: true, adAccountId }),
  });
}

export async function listClientAudits(clientId: string): Promise<AuditRunPublic[]> {
  const result = await api<{ audits: AuditRunPublic[] }>(`/clients/${clientId}/audits`);
  return result.audits;
}

export async function getAudit(auditId: string): Promise<AuditBundleResponse> {
  return api(`/audits/${auditId}`);
}

export async function listClientRecommendations(clientId: string): Promise<RecommendationPublic[]> {
  const result = await api<{ recommendations: RecommendationPublic[] }>(`/clients/${clientId}/recommendations`);
  return result.recommendations;
}

export async function getRecommendation(id: string): Promise<{
  recommendation: RecommendationPublic;
  authorization: AuthorizationPublic | null;
  applyJob: ApplyJobPublic | null;
  client: { id: string; name: string } | null;
  adAccount: {
    id: string;
    platform: Platform;
    externalId: string;
    frozen: boolean;
    connectionStatus: string;
  } | null;
  canApprove: boolean;
  applyGate: { allowed: boolean; blocked: string | null; writes: boolean };
  writes: boolean;
}> {
  return api(`/recommendations/${id}`);
}

export async function decideRecommendation(
  recommendationId: string,
  action: "authorize" | "approve" | "deny" | "snooze",
  note?: string,
  inline?: boolean,
): Promise<{
  recommendation: RecommendationPublic;
  authorization: AuthorizationPublic | null;
  applyJob: ApplyJobPublic | null;
  applied: boolean;
  writes: boolean;
  note?: string;
}> {
  return api(`/recommendations/${recommendationId}/decide`, {
    method: "POST",
    body: JSON.stringify({ action, note, inline }),
  });
}

export async function requestApply(
  recommendationId: string,
  inline?: boolean,
): Promise<{
  applyJob?: ApplyJobPublic;
  writes: boolean;
  allowed?: boolean;
  blocked?: string | null;
  note?: string;
}> {
  return api(`/recommendations/${recommendationId}/apply`, {
    method: "POST",
    body: JSON.stringify({ inline }),
  });
}

export async function disconnectAdAccount(adAccountId: string): Promise<{ adAccount: AdAccountPublic }> {
  return api(`/ad-accounts/${adAccountId}/disconnect`, { method: "POST" });
}

export type OfflineAttributionResponse = {
  visible: boolean;
  source?: "callrail" | "bundled" | null;
  callrail: {
    connected: boolean;
    mock: boolean;
    callCount: number;
    lastPulledAt: string | null;
    lastError: string | null;
  };
  bundled?: {
    connected: boolean;
    mock: boolean;
    trackingNumber?: string | null;
    callCount: number;
    lastPulledAt?: string | null;
    lastError?: string | null;
  };
  crm: { connected: boolean; mock: boolean; bookedJobCount: number };
  sentences: string[];
  joins: { callId: string; sentence: string }[];
  writes: false;
};

export async function getOfflineAttribution(clientId: string): Promise<OfflineAttributionResponse> {
  return api(`/clients/${clientId}/offline-attribution`);
}

export async function connectCallRail(input: {
  clientId: string;
  mock?: boolean;
  useEnv?: boolean;
  apiKey?: string;
  accountId?: string;
}): Promise<{ ok: boolean; writes: false }> {
  return api("/connectors/callrail/connect", { method: "POST", body: JSON.stringify(input) });
}

export async function pullCallRail(clientId: string): Promise<{ ok: boolean; sentences: string[]; writes: false }> {
  return api("/connectors/callrail/pull", { method: "POST", body: JSON.stringify({ clientId }) });
}

export async function connectBundledCallTracking(input: {
  clientId: string;
  mock?: boolean;
  useEnv?: boolean;
  accountSid?: string;
  authToken?: string;
  trackingNumber?: string;
}): Promise<{ ok: boolean; writes: false; purchased: false }> {
  return api("/connectors/bundled/connect", { method: "POST", body: JSON.stringify(input) });
}

export async function pullBundledCallTracking(clientId: string): Promise<{ ok: boolean; sentences: string[]; writes: false }> {
  return api("/connectors/bundled/pull", { method: "POST", body: JSON.stringify({ clientId }) });
}

export async function connectCrmMock(clientId: string): Promise<{ ok: boolean; writes: false }> {
  return api("/connectors/crm/connect", { method: "POST", body: JSON.stringify({ clientId, mock: true }) });
}

export async function setAdAccountFrozen(
  adAccountId: string,
  frozen: boolean,
): Promise<{ adAccount: AdAccountPublic }> {
  return api(`/ad-accounts/${adAccountId}`, {
    method: "PATCH",
    body: JSON.stringify({ frozen }),
  });
}
