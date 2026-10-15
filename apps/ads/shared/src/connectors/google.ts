import type { CapabilityFlags } from "@cerevex/contracts";
import type { ApplyMutation } from "../audit-schemas";
import { googleAdsDeveloperToken } from "../env";
import { platformSyncLiveEnabled } from "../flags";
import {
  GOOGLE_MICROS_SCALE,
  OUTCOME_UNIT,
  amountSnapshots,
  nativeOrScaled,
  outcomeValue,
  percentOf,
  platformNativeAmount,
  stampNoBefore,
  statusSnapshots,
  utcNow,
  type LiveEntityState,
  type MutationOutcome,
} from "../mutate-types";
import { GOOGLE_ADS_API_VERSION } from "../google-ads";
import { GoogleOAuthConfigError, GoogleRefreshRejected, GoogleRetryLater } from "../google-token";
import { googleAuthorizeUrl, googleRedirectUri, isGoogleConfigured } from "../oauth";
import { refuseMockPull } from "../live-or-loud";
import { mockPull, type PullResult, type PulledEntity } from "../platforms";
import type { AccessibleAdAccount, StoredOAuthTokens } from "../types";
import type {
  AdPlatformConnector,
  ConnectorApplyInput,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorExchangeResult,
  ConnectorPullInput,
} from "./types";
import { readPlatformWriteBody, requirePlatformSignal } from "./write-timeout";

const GOOGLE_ADS = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

/** These mean the app credentials are wrong. They are not a revoked user grant. */
const GOOGLE_REFRESH_CONFIG_ERRORS = new Set(["invalid_client", "unauthorized_client", "invalid_request"]);

/** Log a short OAuth code only. Anything else becomes the HTTP status. */
function loggedRefreshCode(errorCode: string, status: number): string {
  if (/^[a-z_]{1,40}$/.test(errorCode)) return errorCode;
  return `http_${status}`;
}

function logGoogleRefreshCode(code: string): void {
  console.warn("google.refresh", code);
}

function notConfigured(): ConnectorConnectResult {
  return {
    ok: false,
    stub: false,
    connectorId: "google",
    reason: "google OAuth is not configured. Use the mock connector or set app credentials.",
  };
}

function digitsOnly(id: string): string {
  return id.replace(/^customers\//, "").replace(/-/g, "");
}

/** Blank values are absent. The token is never logged. */
function putDeveloperToken(headers: Record<string, string>, developerToken: string | null | undefined): void {
  if (typeof developerToken !== "string") return;
  const token = developerToken.trim();
  if (!token) return;
  headers["developer-token"] = token;
}

/**
 * Accounts reached through a manager (MCC) need login-customer-id on every call.
 * Undefined uses the token's stored manager id. Null sends no manager header.
 * There is no process-wide manager fallback.
 */
export function googleAdsHeaders(
  tokens: Pick<StoredOAuthTokens, "accessToken" | "loginCustomerId">,
  developerToken?: string | null,
  loginCustomerId?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokens.accessToken}`,
    "content-type": "application/json",
  };
  putDeveloperToken(headers, developerToken);
  const login = loginCustomerId === undefined ? tokens.loginCustomerId : loginCustomerId;
  if (login) headers["login-customer-id"] = digitsOnly(login);
  return headers;
}

async function googleSearch<T>(
  tokens: StoredOAuthTokens,
  developerToken: string | null | undefined,
  customerId: string,
  query: string,
  loginCustomerId?: string | null,
): Promise<T[]> {
  const res = await fetch(`${GOOGLE_ADS}/customers/${digitsOnly(customerId)}/googleAds:search`, {
    method: "POST",
    headers: googleAdsHeaders(tokens, developerToken, loginCustomerId),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    await res.text().catch(() => undefined);
    if (res.status === 429 || res.status >= 500) throw new GoogleRetryLater(res.status);
    throw new Error(`Google Ads read failed (${res.status})`);
  }
  const body = (await res.json()) as { results?: T[] };
  return body.results ?? [];
}

type GoogleCustomerRow = {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string; manager?: boolean };
};
type GoogleCustomerClientRow = {
  customerClient?: { id?: string; descriptiveName?: string; currencyCode?: string; manager?: boolean };
};

const MAX_GOOGLE_ROOTS = 50;

export async function listGoogleAccessibleAccounts(tokens: StoredOAuthTokens): Promise<AccessibleAdAccount[]> {
  const developerToken = googleAdsDeveloperToken();
  const headers: Record<string, string> = { authorization: `Bearer ${tokens.accessToken}` };
  putDeveloperToken(headers, developerToken);
  const res = await fetch(`${GOOGLE_ADS}/customers:listAccessibleCustomers`, { headers });
  if (!res.ok) throw new Error(`Google Ads account list failed (${res.status})`);
  const { resourceNames = [] } = (await res.json()) as { resourceNames?: string[] };

  const direct = new Map<string, AccessibleAdAccount>();
  const managed = new Map<string, AccessibleAdAccount>();
  let firstError: unknown = null;
  for (const resourceName of resourceNames.slice(0, MAX_GOOGLE_ROOTS)) {
    const id = digitsOnly(resourceName);
    try {
      const [row] = await googleSearch<GoogleCustomerRow>(
        tokens,
        developerToken,
        id,
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
        null,
      );
      const name = row?.customer?.descriptiveName || id;
      if (!row?.customer?.manager) {
        direct.set(id, { externalId: id, name, currency: row?.customer?.currencyCode ?? null, detail: null, loginCustomerId: null });
        continue;
      }
      const children = await googleSearch<GoogleCustomerClientRow>(
        tokens,
        developerToken,
        id,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager FROM customer_client WHERE customer_client.level = 1",
        id,
      );
      for (const child of children) {
        const cc = child.customerClient;
        if (!cc?.id || cc.manager) continue;
        const childId = digitsOnly(cc.id);
        if (!managed.has(childId)) {
          managed.set(childId, {
            externalId: childId,
            name: cc.descriptiveName || childId,
            currency: cc.currencyCode ?? null,
            detail: `Managed by ${name}`,
            loginCustomerId: id,
          });
        }
      }
    } catch (error) {
      firstError ??= error;
    }
  }
  const all = [...direct.values(), ...[...managed.values()].filter((a) => !direct.has(a.externalId))];
  if (all.length === 0 && firstError) throw firstError;
  return all;
}

async function pullGoogleLive(tokens: StoredOAuthTokens, externalId: string) {
  const developerToken = googleAdsDeveloperToken();
  const customerId = digitsOnly(externalId);
  const query = `
    SELECT campaign.id, campaign.name, campaign.status
    FROM campaign
    LIMIT 50
  `;
  const res = await fetch(`${GOOGLE_ADS}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: googleAdsHeaders(tokens, developerToken),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    await res.text().catch(() => undefined);
    if (res.status === 429 || res.status >= 500) throw new GoogleRetryLater(res.status);
    throw new Error(`Google Ads read failed (${res.status})`);
  }
  const body = (await res.json()) as {
    results?: { campaign?: { id?: string; name?: string; status?: string } }[];
  };
  const entities: PulledEntity[] = (body.results ?? []).flatMap((row) => {
    if (!row.campaign?.id) return [];
    return [
      {
        entityType: "campaign",
        externalId: row.campaign.id,
        name: row.campaign.name ?? row.campaign.id,
        status: (row.campaign.status ?? "unknown").toLowerCase(),
      },
    ];
  });

  const groupsResult = await googleSearchOptional<GoogleAdGroupRow>(
    tokens,
    developerToken,
    customerId,
    "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED' LIMIT 200",
  );
  const groups = groupsResult.rows;
  let partial = groupsResult.failed;
  for (const row of groups) {
    if (!row.adGroup?.id) continue;
    entities.push({
      entityType: "ad_group",
      externalId: row.adGroup.id,
      name: row.adGroup.name ?? row.adGroup.id,
      status: String(row.adGroup.status ?? "unknown").toLowerCase(),
      parentExternalId: row.campaign?.id,
    });
  }

  const adsResult = await googleSearchOptional<GoogleAdRow>(
    tokens,
    developerToken,
    customerId,
    "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' LIMIT 200",
  );
  const ads = adsResult.rows;
  partial = partial || adsResult.failed;
  for (const row of ads) {
    const adId = row.adGroupAd?.ad?.id;
    if (!adId) continue;
    entities.push({
      entityType: "ad",
      externalId: adId,
      name: row.adGroupAd?.ad?.name ?? adId,
      status: String(row.adGroupAd?.status ?? "unknown").toLowerCase(),
      parentExternalId: row.adGroup?.id,
    });
  }

  const metricsResult = await pullGoogleMetrics(tokens, developerToken, customerId);
  partial = partial || metricsResult.partial;
  return {
    mode: "live" as const,
    externalAccountId: customerId,
    entities,
    metrics: metricsResult.metrics,
    ...(partial ? { partial: true as const } : {}),
  };
}

type GoogleAdGroupRow = {
  adGroup?: { id?: string; name?: string; status?: string };
  campaign?: { id?: string };
};
type GoogleAdRow = {
  adGroupAd?: { status?: string; ad?: { id?: string; name?: string } };
  adGroup?: { id?: string };
  campaign?: { id?: string };
};
type GoogleMetricRow = {
  campaign?: { id?: string };
  adGroup?: { id?: string };
  adGroupAd?: { ad?: { id?: string } };
  metrics?: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number | string };
};

const GOOGLE_METRIC_WINDOWS = [
  ["TODAY", "today"],
  ["LAST_7_DAYS", "7d"],
  ["LAST_14_DAYS", "14d"],
  ["LAST_30_DAYS", "30d"],
] as const;

/** A failed secondary search is a partial pull, not an empty success. The error text is dropped. */
async function googleSearchOptional<T>(
  tokens: StoredOAuthTokens,
  developerToken: string | null | undefined,
  customerId: string,
  query: string,
): Promise<{ rows: T[]; failed: boolean }> {
  try {
    return { rows: await googleSearch<T>(tokens, developerToken, customerId, query), failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

async function pullGoogleMetrics(
  tokens: StoredOAuthTokens,
  developerToken: string | null | undefined,
  customerId: string,
): Promise<{ metrics: PullResult["metrics"]; partial: boolean }> {
  const metrics: PullResult["metrics"] = [];
  let partial = false;
  const levels = [
    {
      entityType: "campaign",
      from: "campaign",
      idOf: (row: GoogleMetricRow) => row.campaign?.id,
    },
    {
      entityType: "ad_group",
      from: "ad_group",
      idOf: (row: GoogleMetricRow) => row.adGroup?.id,
    },
    {
      entityType: "ad",
      from: "ad_group_ad",
      idOf: (row: GoogleMetricRow) => row.adGroupAd?.ad?.id,
    },
  ] as const;
  for (const level of levels) {
    for (const [during, window] of GOOGLE_METRIC_WINDOWS) {
      const searched = await googleSearchOptional<GoogleMetricRow>(
        tokens,
        developerToken,
        customerId,
        `SELECT ${level.entityType === "ad" ? "ad_group_ad.ad.id" : level.entityType === "ad_group" ? "ad_group.id" : "campaign.id"}, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ${level.from} WHERE segments.date DURING ${during}`,
      );
      if (searched.failed) partial = true;
      const rows = searched.rows;
      const summed = new Map<string, { costMicros: number; impressions: number; clicks: number; conversions: number }>();
      for (const row of rows) {
        const id = level.idOf(row);
        if (!id) continue;
        const current = summed.get(id) ?? { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 };
        current.costMicros += Number(row.metrics?.costMicros ?? 0);
        current.impressions += Number(row.metrics?.impressions ?? 0);
        current.clicks += Number(row.metrics?.clicks ?? 0);
        current.conversions += Number(row.metrics?.conversions ?? 0);
        summed.set(id, current);
      }
      for (const [id, totals] of summed) {
        metrics.push({
          entityExternalId: id,
          entityType: level.entityType,
          window,
          spendUsd: (totals.costMicros / 1_000_000).toFixed(2),
          impressions: totals.impressions,
          clicks: totals.clicks,
          conversions: String(totals.conversions),
        });
      }
    }
  }
  return { metrics, partial };
}

export const GOOGLE_PAUSE_OR_BID = "Google apply is pause or bid only. Nothing was written.";

function refusedGoogle(mutation: ApplyMutation, reason: string): MutationOutcome {
  return {
    action: mutation.action,
    platform: "google",
    target: mutation.target,
    status: "failed",
    mode: "live",
    writes: false,
    reason,
  };
}

function googleLiveQuery(mutation: ApplyMutation): string {
  const resource = mutation.target.externalId;
  if (mutation.target.entityType === "ad") {
    return `SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group.id, customer.currency_code FROM ad_group_ad WHERE ad_group_ad.ad.id = ${resource} LIMIT 2`;
  }
  if (mutation.target.entityType === "campaign") {
    return `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, customer.currency_code FROM campaign WHERE campaign.id = ${resource} LIMIT 1`;
  }
  return `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, customer.currency_code FROM ad_group WHERE ad_group.id = ${resource} LIMIT 1`;
}

/** Pause: campaign, ad group, and ad each have their own resource. An ad's status lives on the ad group ad. */
function googlePauseOperation(
  customerId: string,
  mutation: ApplyMutation,
  live: LiveEntityState | null,
): { operation: Record<string, unknown> } | { reason: string } {
  const id = mutation.target.externalId;
  if (mutation.target.entityType === "campaign") {
    return {
      operation: {
        campaignOperation: {
          update: {
            resourceName: `customers/${customerId}/campaigns/${id}`,
            status: "PAUSED",
          },
          updateMask: "status",
        },
      },
    };
  }
  if (mutation.target.entityType === "ad_group") {
    return {
      operation: {
        adGroupOperation: {
          update: {
            resourceName: `customers/${customerId}/adGroups/${id}`,
            status: "PAUSED",
          },
          updateMask: "status",
        },
      },
    };
  }
  if (mutation.target.entityType === "ad") {
    const adGroupId = live?.parentExternalId?.trim();
    if (!adGroupId) return { reason: "Missing ad group. Nothing was written." };
    return {
      operation: {
        adGroupAdOperation: {
          update: {
            resourceName: `customers/${customerId}/adGroupAds/${adGroupId}~${id}`,
            status: "PAUSED",
          },
          updateMask: "status",
        },
      },
    };
  }
  return { reason: "Google pause needs a campaign, ad group, or ad. Nothing was written." };
}

export class GoogleAdPlatformConnector implements AdPlatformConnector {
  readonly kind = "ad_platform" as const;
  readonly id = "google" as const;
  readonly label = "Google Ads";
  readonly implementation = "live" as const;
  readonly platform = "google" as const;
  readonly connectCapability = "connect.google" as const;

  isConfigured(): boolean {
    return isGoogleConfigured();
  }

  isLiveAllowed(tokens?: StoredOAuthTokens | null, flags?: CapabilityFlags): boolean {
    if (tokens?.mock) return false;
    if (!platformSyncLiveEnabled(flags)) return false;
    return this.isConfigured();
  }

  authorizeUrl(state: string): string {
    return googleAuthorizeUrl(state);
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (!this.isConfigured()) return notConfigured();
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      externalId: input.externalId,
      reason: "Use /oauth/google/start — exchangeCode on this connector performs the token exchange.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return { ok: true, stub: false, connectorId: this.id };
  }

  async pull(input: ConnectorPullInput) {
    refuseMockPull(input.tokens, input.allowLive);
    if (input.tokens.mock) {
      return mockPull("google", input.clientName);
    }
    return pullGoogleLive(input.tokens, input.externalId);
  }

  async refreshTokens(tokens: StoredOAuthTokens): Promise<StoredOAuthTokens> {
    if (tokens.mock) return tokens;
    if (!tokens.refreshToken) throw new GoogleRefreshRejected();
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error("google.not_configured");
    }
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    });
    let res: Response;
    try {
      res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      throw new GoogleRetryLater(503);
    }
    const raw = await res.text().catch(() => "");
    if (res.status === 429 || res.status >= 500) throw new GoogleRetryLater(res.status);
    let accessToken: string | undefined;
    let expiresIn: number | undefined;
    let refreshToken: string | undefined;
    let errorCode = "";
    try {
      const json = JSON.parse(raw) as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        error?: string;
      };
      accessToken = typeof json.access_token === "string" ? json.access_token : undefined;
      expiresIn = json.expires_in;
      refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
      errorCode = typeof json.error === "string" ? json.error : "";
    } catch {
      accessToken = undefined;
    }
    if (errorCode === "invalid_grant") throw new GoogleRefreshRejected();
    if (GOOGLE_REFRESH_CONFIG_ERRORS.has(errorCode) || !res.ok) {
      const code = loggedRefreshCode(errorCode, res.status);
      logGoogleRefreshCode(code);
      throw new GoogleOAuthConfigError(code);
    }
    if (!accessToken) {
      logGoogleRefreshCode("empty_access_token");
      throw new GoogleRetryLater(502);
    }
    return {
      ...tokens,
      accessToken,
      refreshToken: refreshToken || tokens.refreshToken,
      expiresAt: typeof expiresIn === "number"
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : tokens.expiresAt,
    };
  }

  async exchangeCode(code: string): Promise<ConnectorExchangeResult> {
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(),
      code,
      grant_type: "authorization_code",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error("Google token exchange failed");
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!json.access_token) {
      throw new Error("Google token exchange returned no access token");
    }
    return {
      tokens: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        tokenType: json.token_type,
        expiresAt: json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : undefined,
        scopes: ["https://www.googleapis.com/auth/adwords"],
        mock: false,
      },
      externalId: "pending",
    };
  }

  async listAccessibleAccounts(tokens: StoredOAuthTokens): Promise<AccessibleAdAccount[]> {
    if (tokens.mock) return [];
    return listGoogleAccessibleAccounts(tokens);
  }

  async readLiveEntityState(input: {
    tokens: StoredOAuthTokens;
    mutation: ApplyMutation;
    accountExternalId?: string;
    deadlineAt?: number;
    signal?: AbortSignal;
  }): Promise<LiveEntityState | null> {
    if (input.tokens.mock) return null;
    const developerToken = googleAdsDeveloperToken();
    const { mutation, tokens } = input;
    const customer = input.accountExternalId ? digitsOnly(input.accountExternalId) : "";
    if (!customer) return null;
    const query = googleLiveQuery(mutation);
    const res = await fetch(`${GOOGLE_ADS}/customers/${customer}/googleAds:search`, {
      method: "POST",
      headers: googleAdsHeaders(tokens, developerToken),
      body: JSON.stringify({ query }),
      signal: input.signal ?? requirePlatformSignal(input.deadlineAt),
    });
    if (!res.ok) {
      await res.text().catch(() => undefined);
      if (res.status === 429 || res.status >= 500) throw new GoogleRetryLater(res.status);
      return null;
    }
    const body = (await res.json()) as {
      results?: Array<{
        campaign?: { status?: string };
        campaignBudget?: { amountMicros?: string };
        adGroup?: { id?: string; status?: string; cpcBidMicros?: string };
        adGroupAd?: { status?: string };
        customer?: { currencyCode?: string };
      }>;
    };
    const results = body.results ?? [];
    if (mutation.target.entityType === "ad") {
      if (results.length !== 1) return null;
      const parent = results[0]?.adGroup?.id?.trim();
      if (!parent) return null;
      const currency = typeof results[0]?.customer?.currencyCode === "string" ? results[0].customer.currencyCode : null;
      return {
        externalId: mutation.target.externalId,
        entityType: mutation.target.entityType,
        status: (results[0]?.adGroupAd?.status ?? "unknown").toLowerCase(),
        parentExternalId: parent,
        currency,
        readAt: utcNow(),
      };
    }
    const row = results[0];
    if (!row) return null;
    const budgetNative = platformNativeAmount(row.campaignBudget?.amountMicros);
    const bidNative = platformNativeAmount(row.adGroup?.cpcBidMicros);
    const currency = typeof row.customer?.currencyCode === "string" ? row.customer.currencyCode : null;
    return {
      externalId: mutation.target.externalId,
      entityType: mutation.target.entityType,
      status: (row.campaign?.status ?? row.adGroup?.status ?? "unknown").toLowerCase(),
      dailyBudget: budgetNative ? Number(budgetNative) / GOOGLE_MICROS_SCALE : null,
      bidAmount: bidNative ? Number(bidNative) / GOOGLE_MICROS_SCALE : null,
      budgetNative,
      bidNative,
      currency,
      readAt: utcNow(),
    };
  }

  async applyLive(input: ConnectorApplyInput): Promise<MutationOutcome> {
    const { tokens, mutation, live, accountExternalId } = input;
    if (mutation.action !== "pause" && mutation.action !== "update_bid") {
      return refusedGoogle(mutation, GOOGLE_PAUSE_OR_BID);
    }
    const developerToken = googleAdsDeveloperToken();
    const customerId = accountExternalId.replace(/^customers\//, "").replace(/-/g, "");
    const operations: Record<string, unknown>[] = [];

    let recorded: Pick<MutationOutcome, "before" | "after" | "revertible" | "revertBlock"> | null = null;
    if (mutation.action === "pause") {
      if (live?.status === "paused") {
        return {
          action: mutation.action,
          platform: "google",
          target: mutation.target,
          status: "already_applied",
          mode: "live",
          writes: false,
          reason: "Already paused on Google Ads.",
          ...statusSnapshots({
            beforeStatus: "paused",
            afterStatus: "paused",
            currency: live.currency,
            readAt: live.readAt,
            alreadyApplied: true,
          }),
        };
      }
      const pause = googlePauseOperation(customerId, mutation, live);
      if ("reason" in pause) return refusedGoogle(mutation, pause.reason);
      operations.push(pause.operation);
      recorded = live
        ? statusSnapshots({
            beforeStatus: live.status,
            afterStatus: "paused",
            currency: live.currency,
            readAt: live.readAt,
          })
        : stampNoBefore({
            action: mutation.action,
            platform: "google",
            target: mutation.target,
            status: "applied",
            mode: "live",
            writes: true,
            after: outcomeValue({ status: "paused", unit: OUTCOME_UNIT.status }),
          });
    } else {
      const next = percentOf(live?.bidAmount ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Google bid change without a current bid or absolute amount.");
      }
      const afterAmount = String(Math.round(next * GOOGLE_MICROS_SCALE));
      const beforeAmount = nativeOrScaled(live?.bidNative, live?.bidAmount, GOOGLE_MICROS_SCALE);
      if (beforeAmount != null && beforeAmount === afterAmount) {
        return {
          action: mutation.action,
          platform: "google",
          target: mutation.target,
          status: "already_applied",
          mode: "live",
          writes: false,
          reason: "Bid already matches on Google Ads.",
          ...amountSnapshots({
            beforeAmount,
            afterAmount,
            unit: OUTCOME_UNIT.micros,
            currency: live?.currency,
            readAt: live?.readAt,
          }),
        };
      }
      operations.push({
        adGroupOperation: {
          update: {
            resourceName: `customers/${customerId}/adGroups/${mutation.target.externalId}`,
            cpcBidMicros: afterAmount,
          },
          updateMask: "cpc_bid_micros",
        },
      });
      recorded = amountSnapshots({
        beforeAmount,
        afterAmount,
        unit: OUTCOME_UNIT.micros,
        currency: live?.currency,
        readAt: live?.readAt,
      });
    }

    const res = await fetch(`${GOOGLE_ADS}/customers/${customerId}/googleAds:mutate`, {
      method: "POST",
      headers: googleAdsHeaders(tokens, developerToken),
      body: JSON.stringify({ mutateOperations: operations }),
      signal: input.signal ?? requirePlatformSignal(input.deadlineAt),
    });
    if (res.status === 429) {
      await res.text().catch(() => undefined);
      throw new GoogleRetryLater(res.status);
    }
    await readPlatformWriteBody(res, "Google Ads write failed");
    return {
      action: mutation.action,
      platform: "google",
      target: mutation.target,
      status: "applied",
      mode: "live",
      writes: true,
      ...recorded,
    };
  }
}

export const googleAdPlatformConnector = new GoogleAdPlatformConnector();
