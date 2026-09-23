import type { CapabilityFlags } from "@shopify-brain/contracts";
import type { ApplyMutation } from "../audit-schemas";
import { platformSyncLiveEnabled } from "../flags";
import { percentOf, type LiveEntityState, type MutationOutcome } from "../mutate-types";
import { isMetaConfigured, metaAuthorizeUrl, metaRedirectUri } from "../oauth";
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

const GRAPH = "https://graph.facebook.com/v21.0";

function notConfigured(): ConnectorConnectResult {
  return {
    ok: false,
    stub: false,
    connectorId: "meta",
    reason: "meta OAuth is not configured. Use the mock connector or set app credentials.",
  };
}

async function graphPost(path: string, accessToken: string, body: Record<string, string>): Promise<unknown> {
  const params = new URLSearchParams({ ...body, access_token: accessToken });
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta write failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function graphGet(path: string, accessToken: string): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${GRAPH}/${path}`;
  const separator = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${separator}access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) {
    throw new Error(`Meta Graph read failed (${res.status})`);
  }
  return res.json();
}

async function pullMetaLive(tokens: StoredOAuthTokens, externalId: string) {
  const act = externalId.startsWith("act_") ? externalId : `act_${externalId}`;
  const campaigns = (await graphGet(
    `${act}/campaigns?fields=id,name,status,objective&limit=50`,
    tokens.accessToken,
  )) as { data?: { id: string; name: string; status: string }[] };
  const adsets = (await graphGet(
    `${act}/adsets?fields=id,name,status,campaign_id&limit=50`,
    tokens.accessToken,
  )) as { data?: { id: string; name: string; status: string; campaign_id?: string }[] };
  const ads = (await graphGet(
    `${act}/ads?fields=id,name,status,adset_id&limit=50`,
    tokens.accessToken,
  )) as { data?: { id: string; name: string; status: string; adset_id?: string }[] };

  const entities = [
    ...(campaigns.data ?? []).map((row) => ({
      entityType: "campaign",
      externalId: row.id,
      name: row.name,
      status: row.status.toLowerCase(),
    })),
    ...(adsets.data ?? []).map((row) => ({
      entityType: "adset",
      externalId: row.id,
      name: row.name,
      status: row.status.toLowerCase(),
      parentExternalId: row.campaign_id,
    })),
    ...(ads.data ?? []).map((row) => ({
      entityType: "ad",
      externalId: row.id,
      name: row.name,
      status: row.status.toLowerCase(),
      parentExternalId: row.adset_id,
    })),
  ];

  const metrics = [];
  for (const window of ["last_7d", "last_30d"] as const) {
    const insights = (await graphGet(
      `${act}/insights?date_preset=${window}&fields=campaign_id,spend,impressions,clicks,actions&level=campaign`,
      tokens.accessToken,
    )) as {
      data?: {
        campaign_id?: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: { action_type: string; value: string }[];
      }[];
    };
    for (const row of insights.data ?? []) {
      if (!row.campaign_id) continue;
      const conversions = row.actions?.find((a) => a.action_type.includes("lead") || a.action_type.includes("purchase"));
      metrics.push({
        entityExternalId: row.campaign_id,
        entityType: "campaign",
        window: window === "last_7d" ? ("7d" as const) : ("30d" as const),
        spendUsd: row.spend ?? "0",
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: conversions?.value ?? "0",
      });
    }
  }

  return { mode: "live" as const, externalAccountId: act, entities, metrics };
}

export class MetaAdPlatformConnector implements AdPlatformConnector {
  readonly kind = "ad_platform" as const;
  readonly id = "meta" as const;
  readonly label = "Meta Ads";
  readonly implementation = "live" as const;
  readonly platform = "meta" as const;
  readonly connectCapability = "connect.meta" as const;

  isConfigured(): boolean {
    return isMetaConfigured();
  }

  isLiveAllowed(tokens?: StoredOAuthTokens | null, flags?: CapabilityFlags): boolean {
    if (tokens?.mock) return false;
    if (!platformSyncLiveEnabled(flags)) return false;
    return this.isConfigured();
  }

  authorizeUrl(state: string): string {
    return metaAuthorizeUrl(state);
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (!this.isConfigured()) return notConfigured();
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      externalId: input.externalId,
      reason: "Use /oauth/meta/start — exchangeCode on this connector performs the token exchange.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return { ok: true, stub: false, connectorId: this.id };
  }

  async pull(input: ConnectorPullInput) {
    if (input.tokens.mock || !input.allowLive) {
      return mockPull("meta", input.clientName);
    }
    return pullMetaLive(input.tokens, input.externalId);
  }

  async refreshTokens(tokens: StoredOAuthTokens): Promise<StoredOAuthTokens> {
    if (tokens.mock) return tokens;
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) return tokens;
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: tokens.accessToken,
    });
    const res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
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
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID ?? "",
      client_secret: process.env.META_APP_SECRET ?? "",
      redirect_uri: metaRedirectUri(),
      code,
    });
    const res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
    if (!res.ok) {
      throw new Error("Meta token exchange failed");
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error("Meta token exchange returned no access token");
    }
    let externalId = "pending";
    try {
      const me = (await fetch(
        `${GRAPH}/me/adaccounts?fields=id,account_id&access_token=${encodeURIComponent(json.access_token)}`,
      ).then((r) => r.json())) as { data?: { id?: string; account_id?: string }[] };
      externalId = me.data?.[0]?.id ?? me.data?.[0]?.account_id ?? "pending";
    } catch {
      externalId = "pending";
    }
    return {
      tokens: {
        accessToken: json.access_token,
        expiresAt: json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : undefined,
        scopes: ["ads_read", "ads_management"],
        mock: false,
      },
      externalId,
    };
  }

  async readLiveEntityState(input: {
    tokens: StoredOAuthTokens;
    mutation: ApplyMutation;
  }): Promise<LiveEntityState | null> {
    if (input.tokens.mock) return null;
    const { mutation, tokens } = input;
    const fields =
      mutation.target.entityType === "campaign" ? "id,name,status,daily_budget" : "id,name,status,bid_amount";
    const json = (await graphGet(`${mutation.target.externalId}?fields=${fields}`, tokens.accessToken)) as {
      id?: string;
      status?: string;
      daily_budget?: string;
      bid_amount?: string;
    };
    return {
      externalId: json.id ?? mutation.target.externalId,
      entityType: mutation.target.entityType,
      status: (json.status ?? "unknown").toLowerCase(),
      dailyBudget: json.daily_budget ? Number(json.daily_budget) / 100 : null,
      bidAmount: json.bid_amount ? Number(json.bid_amount) / 100 : null,
    };
  }

  async applyLive(input: ConnectorApplyInput): Promise<MutationOutcome> {
    const { tokens, mutation, live } = input;
    const id = mutation.target.externalId;
    if (mutation.action === "pause") {
      if (live?.status === "paused") {
        return {
          action: mutation.action,
          platform: "meta",
          target: mutation.target,
          status: "already_applied",
          mode: "live",
          writes: false,
          reason: "Already paused on Meta.",
        };
      }
      await graphPost(id, tokens.accessToken, { status: "PAUSED" });
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    if (mutation.action === "update_budget") {
      const next = percentOf(live?.dailyBudget ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Meta budget change without a current daily budget or absolute amount.");
      }
      await graphPost(id, tokens.accessToken, { daily_budget: String(Math.round(next * 100)) });
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    if (mutation.action === "update_bid") {
      const next = percentOf(live?.bidAmount ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Meta bid change without a current bid or absolute amount.");
      }
      await graphPost(id, tokens.accessToken, { bid_amount: String(Math.round(next * 100)) });
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    if (mutation.action === "exclude_placement") {
      const placement = typeof mutation.payload.placement === "string" ? mutation.payload.placement : "audience_network";
      await graphPost(id, tokens.accessToken, {
        targeting: JSON.stringify({ publisher_platforms: ["facebook", "instagram"].filter((p) => p !== placement) }),
      });
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    throw new Error(`Meta mutation ${mutation.action} is not implemented`);
  }
}

export const metaAdPlatformConnector = new MetaAdPlatformConnector();
