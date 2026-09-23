import type { ApplyMutation } from "../audit-schemas";
import { percentOf, type LiveEntityState, type MutationOutcome } from "../mutate-types";
import { googleAuthorizeUrl, googleRedirectUri, isGoogleConfigured } from "../oauth";
import { mockPull } from "../platforms";
import type { StoredOAuthTokens } from "../types";
import type {
  AdPlatformConnector,
  ConnectorApplyInput,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorExchangeResult,
  ConnectorPullInput,
} from "./types";

const GOOGLE_ADS = "https://googleads.googleapis.com/v17";

function notConfigured(): ConnectorConnectResult {
  return {
    ok: false,
    stub: false,
    connectorId: "google",
    reason: "google OAuth is not configured. Use the mock connector or set app credentials.",
  };
}

async function pullGoogleLive(tokens: StoredOAuthTokens, externalId: string) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured — cannot live-read Google Ads");
  }
  const customerId = externalId.replace(/-/g, "");
  const query = `
    SELECT campaign.id, campaign.name, campaign.status
    FROM campaign
    LIMIT 50
  `;
  const res = await fetch(`${GOOGLE_ADS}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.accessToken}`,
      "developer-token": developerToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`Google Ads read failed (${res.status})`);
  }
  const body = (await res.json()) as {
    results?: { campaign?: { id?: string; name?: string; status?: string } }[];
  };
  const entities = (body.results ?? []).flatMap((row) => {
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
  return { mode: "live" as const, externalAccountId: customerId, entities, metrics: [] };
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

  isLiveAllowed(tokens?: StoredOAuthTokens | null): boolean {
    if (tokens?.mock) return false;
    if (process.env.PLATFORM_SYNC_LIVE === "0") return false;
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
    if (input.tokens.mock || !input.allowLive) {
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

  async readLiveEntityState(input: {
    tokens: StoredOAuthTokens;
    mutation: ApplyMutation;
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
        ? `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${resource} LIMIT 1`
        : `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.id = ${resource} LIMIT 1`;
    const customer = customerId ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "";
    if (!customer) return null;
    const res = await fetch(`${GOOGLE_ADS}/customers/${customer.replace(/-/g, "")}/googleAds:search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "developer-token": developerToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: Array<{
        campaign?: { status?: string };
        campaignBudget?: { amountMicros?: string };
        adGroup?: { status?: string; cpcBidMicros?: string };
      }>;
    };
    const row = body.results?.[0];
    return {
      externalId: mutation.target.externalId,
      entityType: mutation.target.entityType,
      status: (row?.campaign?.status ?? row?.adGroup?.status ?? "unknown").toLowerCase(),
      dailyBudget: row?.campaignBudget?.amountMicros ? Number(row.campaignBudget.amountMicros) / 1_000_000 : null,
      bidAmount: row?.adGroup?.cpcBidMicros ? Number(row.adGroup.cpcBidMicros) / 1_000_000 : null,
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
    } else if (mutation.action === "update_budget") {
      const next = percentOf(live?.dailyBudget ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Google budget change without a current budget or absolute amount.");
      }
      operations.push({
        campaignBudgetOperation: {
          update: {
            resourceName: `customers/${customerId}/campaignBudgets/${mutation.target.externalId}`,
            amountMicros: String(Math.round(next * 1_000_000)),
          },
          updateMask: "amount_micros",
        },
      });
    } else if (mutation.action === "update_bid") {
      const next = percentOf(live?.bidAmount ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Google bid change without a current bid or absolute amount.");
      }
      operations.push({
        adGroupOperation: {
          update: {
            resourceName: `customers/${customerId}/adGroups/${mutation.target.externalId}`,
            cpcBidMicros: String(Math.round(next * 1_000_000)),
          },
          updateMask: "cpc_bid_micros",
        },
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
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "developer-token": developerToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ mutateOperations: operations }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Ads write failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return { action: mutation.action, platform: "google", target: mutation.target, status: "applied", mode: "live", writes: true };
  }
}

export const googleAdPlatformConnector = new GoogleAdPlatformConnector();
