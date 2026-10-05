import type { CapabilityFlags } from "@cerevex/contracts";
import type { ApplyMutation } from "../audit-schemas";
import { platformSyncLiveEnabled } from "../flags";
import { percentOf, type LiveEntityState, type MutationOutcome } from "../mutate-types";
import { isMetaConfigured, metaAuthorizeUrl, metaRedirectUri } from "../oauth";
import { mockPull } from "../platforms";
import type { AccessibleAdAccount, StoredOAuthTokens } from "../types";
import type {
  AdPlatformConnector,
  ConnectorApplyInput,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorExchangeResult,
  ConnectorPullInput,
} from "./types";
import { requirePlatformSignal, signalForPlatformCall } from "./write-timeout";

const GRAPH = "https://graph.facebook.com/v21.0";

function notConfigured(): ConnectorConnectResult {
  return {
    ok: false,
    stub: false,
    connectorId: "meta",
    reason: "meta OAuth is not configured. Use the mock connector or set app credentials.",
  };
}

async function graphPost(
  path: string,
  accessToken: string,
  body: Record<string, string>,
  signal?: AbortSignal | null,
): Promise<unknown> {
  const params = new URLSearchParams({ ...body, access_token: accessToken });
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: signal ?? signalForPlatformCall() ?? undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta write failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function graphGet(path: string, accessToken: string, signal?: AbortSignal | null): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${GRAPH}/${path}`;
  const separator = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${separator}access_token=${encodeURIComponent(accessToken)}`, {
    signal: signal ?? signalForPlatformCall() ?? undefined,
  });
  if (!res.ok) {
    throw new Error(`Meta Graph read failed (${res.status})`);
  }
  return res.json();
}

type MetaStatusRow = {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  updated_time?: string;
  campaign_id?: string;
  adset_id?: string;
};

function metaEntity(
  row: MetaStatusRow,
  entityType: string,
  parentExternalId?: string,
) {
  const configured = (row.status ?? "unknown").toLowerCase();
  const effective = (row.effective_status ?? row.status ?? "unknown").toLowerCase();
  return {
    entityType,
    externalId: row.id,
    name: row.name,
    status: effective,
    parentExternalId,
    raw: {
      configuredStatus: configured,
      effectiveStatus: row.effective_status ?? null,
      updatedTime: row.updated_time ?? null,
      updated_time: row.updated_time ?? null,
    },
  };
}

const META_WINDOWS = [
  { preset: "today", window: "today" as const, required: false },
  { preset: "last_7d", window: "7d" as const, required: true },
  { preset: "last_14d", window: "14d" as const, required: false },
  { preset: "last_30d", window: "30d" as const, required: true },
] as const;

const META_LEVELS = [
  { level: "campaign", idField: "campaign_id", entityType: "campaign", required: true },
  { level: "adset", idField: "adset_id", entityType: "adset", required: false },
  { level: "ad", idField: "ad_id", entityType: "ad", required: false },
] as const;

async function pullMetaLive(tokens: StoredOAuthTokens, externalId: string) {
  const act = externalId.startsWith("act_") ? externalId : `act_${externalId}`;
  const fields = "id,name,status,effective_status,updated_time";
  const campaigns = (await graphGet(
    `${act}/campaigns?fields=${fields},objective&limit=50`,
    tokens.accessToken,
  )) as { data?: MetaStatusRow[] };
  const adsets = (await graphGet(
    `${act}/adsets?fields=${fields},campaign_id&limit=50`,
    tokens.accessToken,
  )) as { data?: MetaStatusRow[] };
  const ads = (await graphGet(
    `${act}/ads?fields=${fields},adset_id&limit=50`,
    tokens.accessToken,
  )) as { data?: MetaStatusRow[] };

  const entities = [
    ...(campaigns.data ?? []).map((row) => metaEntity(row, "campaign")),
    ...(adsets.data ?? []).map((row) => metaEntity(row, "adset", row.campaign_id)),
    ...(ads.data ?? []).map((row) => metaEntity(row, "ad", row.adset_id)),
  ];

  const metrics = [];
  for (const level of META_LEVELS) {
    for (const window of META_WINDOWS) {
      const required = level.required && window.required;
      type MetaInsightRow = {
        spend?: string;
        impressions?: string;
        clicks?: string;
        campaign_id?: string;
        adset_id?: string;
        ad_id?: string;
        actions?: { action_type: string; value: string }[];
      };
      let insights: { data?: MetaInsightRow[] } | null = null;
      try {
        insights = (await graphGet(
          `${act}/insights?date_preset=${window.preset}&fields=${level.idField},spend,impressions,clicks,actions&level=${level.level}`,
          tokens.accessToken,
        )) as { data?: MetaInsightRow[] };
      } catch (error) {
        if (required) throw error;
        continue;
      }
      for (const row of insights.data ?? []) {
        const entityExternalId = row[level.idField];
        if (!entityExternalId) continue;
        const conversions = row.actions?.find((action) => action.action_type.includes("lead") || action.action_type.includes("purchase"));
        metrics.push({
          entityExternalId,
          entityType: level.entityType,
          window: window.window,
          spendUsd: row.spend ?? "0",
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          conversions: conversions?.value ?? "0",
        });
      }
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

  async listAccessibleAccounts(tokens: StoredOAuthTokens): Promise<AccessibleAdAccount[]> {
    if (tokens.mock) return [];
    const accounts: AccessibleAdAccount[] = [];
    let next: string | null = "me/adaccounts?fields=id,account_id,name,currency,business{name}&limit=100";
    for (let page = 0; next && page < 10; page++) {
      const json = (await graphGet(next, tokens.accessToken)) as {
        data?: Array<{ id?: string; account_id?: string; name?: string; currency?: string; business?: { name?: string } }>;
        paging?: { next?: string };
      };
      for (const row of json.data ?? []) {
        const externalId = row.id ?? (row.account_id ? `act_${row.account_id}` : null);
        if (!externalId) continue;
        accounts.push({
          externalId,
          name: row.name || externalId,
          currency: row.currency ?? null,
          detail: row.business?.name ?? null,
        });
      }
      next = json.paging?.next ?? null;
    }
    return accounts;
  }

  async readLiveEntityState(input: {
    tokens: StoredOAuthTokens;
    mutation: ApplyMutation;
    deadlineAt?: number;
    signal?: AbortSignal;
  }): Promise<LiveEntityState | null> {
    if (input.tokens.mock) return null;
    const { mutation, tokens } = input;
    const fields =
      mutation.target.entityType === "campaign" ? "id,name,status,daily_budget" : "id,name,status,bid_amount";
    const json = (await graphGet(
      `${mutation.target.externalId}?fields=${fields}`,
      tokens.accessToken,
      input.signal ?? requirePlatformSignal(input.deadlineAt),
    )) as {
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
      await graphPost(id, tokens.accessToken, { status: "PAUSED" }, requirePlatformSignal(input.deadlineAt));
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    if (mutation.action === "update_budget") {
      const next = percentOf(live?.dailyBudget ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Meta budget change without a current daily budget or absolute amount.");
      }
      await graphPost(id, tokens.accessToken, { daily_budget: String(Math.round(next * 100)) }, requirePlatformSignal(input.deadlineAt));
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    if (mutation.action === "update_bid") {
      const next = percentOf(live?.bidAmount ?? null, mutation.payload);
      if (next == null) {
        throw new Error("Cannot compute Meta bid change without a current bid or absolute amount.");
      }
      await graphPost(id, tokens.accessToken, { bid_amount: String(Math.round(next * 100)) }, requirePlatformSignal(input.deadlineAt));
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    if (mutation.action === "create_ad") {
      const name =
        typeof mutation.payload.proposedName === "string"
          ? mutation.payload.proposedName
          : `${mutation.target.name ?? "Ad"} — variant`;
      const message = typeof mutation.payload.body === "string" ? mutation.payload.body : name;
      const imageUrl = typeof mutation.payload.imageUrl === "string" ? mutation.payload.imageUrl : null;
      const accountId = input.accountExternalId.replace(/^act_/, "");
      const creative = (await graphPost(`act_${accountId}/adcreatives`, tokens.accessToken, {
        name: `${name} creative`,
        object_story_spec: JSON.stringify({
          page_id: "page",
          link_data: {
            message,
            name: typeof mutation.payload.headline === "string" ? mutation.payload.headline : name,
            link: "https://example.com",
            ...(imageUrl ? { picture: imageUrl } : {}),
          },
        }),
      }, requirePlatformSignal(input.deadlineAt))) as { id?: string };
      const created = (await graphPost(`act_${accountId}/ads`, tokens.accessToken, {
        name,
        adset_id: mutation.target.externalId,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: "PAUSED",
      }, requirePlatformSignal(input.deadlineAt))) as { id?: string };
      return {
        action: mutation.action,
        platform: "meta",
        target: { entityType: "ad", externalId: created.id ?? mutation.target.externalId, name },
        status: "applied",
        mode: "live",
        writes: true,
        reason: "Created a paused Meta ad. It stays off until you turn it on in Meta.",
      };
    }
    if (mutation.action === "tighten_geo") {
      return {
        action: mutation.action,
        platform: "meta",
        target: mutation.target,
        status: "skipped",
        mode: "live",
        writes: false,
        reason: "Service-area tighten is Approve-recorded. Live location targeting is not in this slice.",
      };
    }
    if (mutation.action === "exclude_placement") {
      const placement = typeof mutation.payload.placement === "string" ? mutation.payload.placement : "audience_network";
      await graphPost(id, tokens.accessToken, {
        targeting: JSON.stringify({ publisher_platforms: ["facebook", "instagram"].filter((p) => p !== placement) }),
      }, requirePlatformSignal(input.deadlineAt));
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    throw new Error(`Meta mutation ${mutation.action} is not implemented`);
  }
}

export const metaAdPlatformConnector = new MetaAdPlatformConnector();
