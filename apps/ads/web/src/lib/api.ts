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

export type MeResponse = {
  user: SessionUser;
  memberships: Membership[];
  clientMemberships: ClientMembership[];
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

export async function getWorkspace(): Promise<{ workspace: WorkspaceSummary | null; canMutate: boolean }> {
  return api("/workspace");
}

export async function patchWorkspace(input: {
  businessType?: BusinessType;
  modules?: Partial<ModuleFlags>;
}): Promise<{ workspace: WorkspaceSummary | null; canMutate: boolean }> {
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

export async function decideRecommendation(
  recommendationId: string,
  action: "authorize" | "deny" | "snooze",
  note?: string,
): Promise<{
  recommendation: RecommendationPublic;
  authorization: AuthorizationPublic | null;
  applied: false;
  writes: false;
}> {
  return api(`/recommendations/${recommendationId}/decide`, {
    method: "POST",
    body: JSON.stringify({ action, note }),
  });
}

export async function requestApply(recommendationId: string): Promise<{
  blocked: string;
  writes: false;
  allowed: false;
  note?: string;
}> {
  return api(`/recommendations/${recommendationId}/apply`, { method: "POST" });
}
