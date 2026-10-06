import type { CapabilityFlags } from "@cerevex/contracts";
import type { ApplyMutation } from "../audit-schemas";
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

/** Accounts reached through a manager (MCC) need login-customer-id on every call. */
export function googleAdsHeaders(
  tokens: Pick<StoredOAuthTokens, "accessToken" | "loginCustomerId">,
  developerToken: string,
  loginCustomerId?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokens.accessToken}`,
    "developer-token": developerToken,
    "content-type": "application/json",
  };
  const login = loginCustomerId ?? tokens.loginCustomerId ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (login) headers["login-customer-id"] = digitsOnly(login);
  return headers;
}

async function googleSearch<T>(
  tokens: StoredOAuthTokens,
  developerToken: string,
  customerId: string,
  query: string,
  loginCustomerId?: string | null,
): Promise<T[]> {
  const res = await fetch(`${GOOGLE_ADS}/customers/${digitsOnly(customerId)}/googleAds:search`, {
    method: "POST",
    headers: googleAdsHeaders(tokens, developerToken, loginCustomerId ?? null),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Google Ads read failed (${res.status})`);
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
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured — cannot list Google Ads accounts");
  }
  const res = await fetch(`${GOOGLE_ADS}/customers:listAccessibleCustomers`, {
    headers: { authorization: `Bearer ${tokens.accessToken}`, "developer-token": developerToken },
  });
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
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured — cannot live-read Google Ads");
  }
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

  const groups = await googleSearchSafe<GoogleAdGroupRow>(
    tokens,
    developerToken,
    customerId,
    "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED' LIMIT 200",
  );
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

  const ads = await googleSearchSafe<GoogleAdRow>(
    tokens,
    developerToken,
    customerId,
    "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' LIMIT 200",
  );
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

  const metrics = await pullGoogleMetrics(tokens, developerToken, customerId);
  return { mode: "live" as const, externalAccountId: customerId, entities, metrics };
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

async function googleSearchSafe<T>(
  tokens: StoredOAuthTokens,
  developerToken: string,
  customerId: string,
  query: string,
): Promise<T[]> {
  try {
    return await googleSearch<T>(tokens, developerToken, customerId, query);
  } catch {
    return [];
  }
}

async function pullGoogleMetrics(
  tokens: StoredOAuthTokens,
  developerToken: string,
  customerId: string,
): Promise<PullResult["metrics"]> {
  const metrics: PullResult["metrics"] = [];
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
      const rows = await googleSearchSafe<GoogleMetricRow>(
        tokens,
        developerToken,
        customerId,
        `SELECT ${level.entityType === "ad" ? "ad_group_ad.ad.id" : level.entityType === "ad_group" ? "ad_group.id" : "campaign.id"}, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ${level.from} WHERE segments.date DURING ${during}`,
      );
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
  return metrics;
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
    if (tokens.mock || !tokens.refreshToken) return tokens;
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return tokens;
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return tokens;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return tokens;
    return {
      ...tokens,
      accessToken: json.access_token,
      expiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
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
    deadlineAt?: number;
    signal?: AbortSignal;
  }): Promise<LiveEntityState | null> {
    if (input.tokens.mock) return null;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) return null;
    const { mutation, tokens } = input;
    const customerId = mutation.target.externalId.includes("/")
      ? mutation.target.externalId.split("/")[1]
      : undefined;
    const resource = mutation.target.externalId;
    const query =
      mutation.target.entityType === "campaign"
        ? `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, customer.currency_code FROM campaign WHERE campaign.id = ${resource} LIMIT 1`
        : `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, customer.currency_code FROM ad_group WHERE ad_group.id = ${resource} LIMIT 1`;
    const customer = customerId ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "";
    if (!customer) return null;
    const res = await fetch(`${GOOGLE_ADS}/customers/${customer.replace(/-/g, "")}/googleAds:search`, {
      method: "POST",
      headers: googleAdsHeaders(tokens, developerToken),
      body: JSON.stringify({ query }),
      signal: input.signal ?? requirePlatformSignal(input.deadlineAt),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: Array<{
        campaign?: { status?: string };
        campaignBudget?: { amountMicros?: string };
        adGroup?: { status?: string; cpcBidMicros?: string };
        customer?: { currencyCode?: string };
      }>;
    };
    const row = body.results?.[0];
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
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) {
      throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured — cannot live-write Google Ads");
    }
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
      operations.push({
        campaignOperation: {
          update: {
            resourceName: `customers/${customerId}/campaigns/${mutation.target.externalId}`,
            status: "PAUSED",
          },
          updateMask: "status",
        },
      });
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
    } else if (mutation.action === "update_budget") {
      const next = percentOf(live?.dailyBudget ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Google budget change without a current budget or absolute amount.");
      }
      const afterAmount = String(Math.round(next * GOOGLE_MICROS_SCALE));
      operations.push({
        campaignBudgetOperation: {
          update: {
            resourceName: `customers/${customerId}/campaignBudgets/${mutation.target.externalId}`,
            amountMicros: afterAmount,
          },
          updateMask: "amount_micros",
        },
      });
      recorded = amountSnapshots({
        beforeAmount: nativeOrScaled(live?.budgetNative, live?.dailyBudget, GOOGLE_MICROS_SCALE),
        afterAmount,
        unit: OUTCOME_UNIT.micros,
        currency: live?.currency,
        readAt: live?.readAt,
      });
    } else if (mutation.action === "update_bid") {
      const next = percentOf(live?.bidAmount ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Google bid change without a current bid or absolute amount.");
      }
      const afterAmount = String(Math.round(next * GOOGLE_MICROS_SCALE));
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
        beforeAmount: nativeOrScaled(live?.bidNative, live?.bidAmount, GOOGLE_MICROS_SCALE),
        afterAmount,
        unit: OUTCOME_UNIT.micros,
        currency: live?.currency,
        readAt: live?.readAt,
      });
    } else if (mutation.action === "add_negative") {
      const text =
        typeof mutation.payload.text === "string" ? mutation.payload.text : "ductless mini split free";
      operations.push({
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${customerId}/campaigns/${mutation.target.externalId}`,
            negative: true,
            keyword: { text, matchType: "PHRASE" },
          },
        },
      });
    } else if (mutation.action === "create_ad") {
      const headline =
        typeof mutation.payload.headline === "string"
          ? mutation.payload.headline
          : typeof mutation.payload.proposedName === "string"
            ? mutation.payload.proposedName
            : "Same-week home visit";
      const body =
        typeof mutation.payload.body === "string" ? mutation.payload.body : "Factory-trained techs. Book a visit.";
      operations.push({
        adGroupAdOperation: {
          create: {
            adGroup: `customers/${customerId}/adGroups/${mutation.target.externalId}`,
            status: "PAUSED",
            ad: {
              responsiveSearchAd: {
                headlines: [{ text: headline.slice(0, 30) }],
                descriptions: [{ text: body.slice(0, 90) }],
              },
            },
          },
        },
      });
    } else if (mutation.action === "tighten_geo") {
      return {
        action: mutation.action,
        platform: "google",
        target: mutation.target,
        status: "skipped",
        mode: "live",
        writes: false,
        reason: "Service-area tighten is Approve-recorded. Live location targeting is not in this slice.",
      };
    } else if (mutation.action === "exclude_placement") {
      const url = typeof mutation.payload.placement === "string" ? mutation.payload.placement : "example.com";
      operations.push({
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${customerId}/campaigns/${mutation.target.externalId}`,
            negative: true,
            placement: { url },
          },
        },
      });
    } else {
      throw new Error(`Google mutation ${mutation.action} is not implemented`);
    }

    const res = await fetch(`${GOOGLE_ADS}/customers/${customerId}/googleAds:mutate`, {
      method: "POST",
      headers: googleAdsHeaders(tokens, developerToken),
      body: JSON.stringify({ mutateOperations: operations }),
      signal: input.signal ?? requirePlatformSignal(input.deadlineAt),
    });
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
