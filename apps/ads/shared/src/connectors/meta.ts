import type { CapabilityFlags } from "@cerevex/contracts";
import type { ApplyMutation } from "../audit-schemas";
import { platformSyncLiveEnabled } from "../flags";
import { percentOf, type LiveEntityState, type MutationOutcome } from "../mutate-types";
import { refuseMockPull } from "../live-or-loud";
import { META_GRAPH_VERSION } from "../meta-graph";
import {
  META_CONNECT_EXTEND_FAILED,
  META_CONNECT_INCOMPLETE,
  META_PERMISSION_MESSAGE,
  META_PERMISSION_MISSING,
  META_RATE_LIMIT_MESSAGE,
  META_RATE_LIMITED,
  META_RECONNECT_MESSAGE,
  META_REFRESH_FAILED,
  META_TOKEN_EXPIRED,
  MetaGraphError,
  MetaRefreshError,
  classifyMetaGraphBody,
  metaExpiryBand,
  metaExpiringMessage,
  scrubMetaSecrets,
} from "../meta-graph-error";
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
import { ApplyCallBudgetError, UnconfirmedPlatformWriteError, requirePlatformSignal, signalForPlatformCall } from "./write-timeout";
import {
  META_COULD_NOT_CONFIRM,
  metaCreateCopy,
  metaCurrencyRefusal,
  metaLiveConfirmRefusal,
  metaTextField,
  metaWriteFailure,
  metaWriteInputRefusal,
  normalizeMetaAccountId,
} from "../meta-write-safety";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const VERSION_WARNING_HEADER = "X-Ad-Api-Version-Warning";

/** Header text only. The request URL and token stay out of the log line. */
function versionWarningMessage(raw: string): string {
  const detail = scrubMetaSecrets(raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return detail
    ? `Meta Graph ${VERSION_WARNING_HEADER}: ${detail}`
    : `Meta Graph ${VERSION_WARNING_HEADER}`;
}

function warnIfVersionHeader(res: Response): void {
  const raw = res.headers.get(VERSION_WARNING_HEADER);
  if (!raw?.trim()) return;
  console.warn(versionWarningMessage(raw));
}

async function graphFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  warnIfVersionHeader(res);
  return res;
}

function notConfigured(): ConnectorConnectResult {
  return {
    ok: false,
    stub: false,
    connectorId: "meta",
    reason: "meta OAuth is not configured. Use the mock connector or set app credentials.",
  };
}

function graphUrl(path: string): string {
  if (!path.startsWith("http")) return `${GRAPH}/${path.replace(/^\//, "")}`;
  const url = new URL(path);
  url.searchParams.delete("access_token");
  url.searchParams.delete("appsecret_proof");
  return url.toString();
}

function bearerHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, ...extra };
}

async function readGraphResponse(res: Response, kind: "read" | "write"): Promise<unknown> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    if (kind === "write" && (res.ok || res.status >= 500)) {
      throw new UnconfirmedPlatformWriteError(
        res.status >= 500 ? `Meta write failed (${res.status})` : "Meta write returned an unreadable body",
      );
    }
    throw new Error(kind === "write" ? `Meta write failed (${res.status})` : `Meta Graph read failed (${res.status})`);
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  const classified = classifyMetaGraphBody(parsed);
  if (classified) throw classified;
  if (kind === "write" && res.status >= 500) {
    throw new UnconfirmedPlatformWriteError(`Meta write failed (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(kind === "write" ? `Meta write failed (${res.status})` : `Meta Graph read failed (${res.status})`);
  }
  if (kind === "write" && !text) throw new UnconfirmedPlatformWriteError("Meta write returned an unreadable body");
  if (parsed == null) {
    if (kind === "write") throw new UnconfirmedPlatformWriteError("Meta write returned an unreadable body");
    throw new Error("Meta Graph read failed");
  }
  return parsed;
}

async function graphPost(
  path: string,
  accessToken: string,
  body: Record<string, string>,
  signal?: AbortSignal | null,
): Promise<unknown> {
  const res = await graphFetch(graphUrl(path), {
    method: "POST",
    headers: bearerHeaders(accessToken, { "content-type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams(body),
    signal: signal ?? signalForPlatformCall() ?? undefined,
  });
  return readGraphResponse(res, "write");
}

async function graphGet(path: string, accessToken: string, signal?: AbortSignal | null): Promise<unknown> {
  const res = await graphFetch(graphUrl(path), {
    headers: bearerHeaders(accessToken),
    signal: signal ?? signalForPlatformCall() ?? undefined,
  });
  return readGraphResponse(res, "read");
}

type OauthTokenJson = { access_token?: string; expires_in?: number; scope?: string; scopes?: string[] };

function grantedScopesFrom(json: OauthTokenJson): string[] | undefined {
  if (Array.isArray(json.scopes) && json.scopes.every((scope) => typeof scope === "string") && json.scopes.length > 0) {
    return json.scopes;
  }
  if (typeof json.scope === "string" && json.scope.trim()) {
    const scopes = json.scope.split(/[,\s]+/).filter(Boolean);
    if (scopes.length > 0) return scopes;
  }
  return undefined;
}

async function requestOauthToken(fields: Record<string, string>, failure: string): Promise<OauthTokenJson> {
  let res: Response;
  try {
    res = await graphFetch(`${GRAPH}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
  } catch {
    throw new Error(failure);
  }
  try {
    return (await readGraphResponse(res, "read")) as OauthTokenJson;
  } catch (error) {
    if (error instanceof MetaGraphError) throw error;
    throw new Error(failure);
  }
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
        if (error instanceof MetaGraphError) throw error;
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

/** Campaigns and ad sets both expose daily_budget. Budget changes read it before the write. */
function metaLiveReadFields(mutation: ApplyMutation): string {
  const fields = ["id", "name", "status", "account_id"];
  if (mutation.action === "update_bid") fields.push("bid_amount");
  else if (mutation.action === "update_budget") fields.push("daily_budget");
  else if (mutation.target.entityType === "campaign") fields.push("daily_budget");
  else fields.push("bid_amount");
  return fields.join(",");
}

async function metaCurrencyWriteRefusal(input: ConnectorApplyInput): Promise<MutationOutcome | null> {
  const { mutation, tokens } = input;
  const signal = input.signal ?? requirePlatformSignal(input.deadlineAt);
  const accountId = normalizeMetaAccountId(input.accountExternalId);
  if (!accountId) return metaWriteFailure(mutation, META_COULD_NOT_CONFIRM);
  let currency: string | null = null;
  try {
    const json = (await graphGet(`act_${accountId}?fields=currency`, tokens.accessToken, signal)) as {
      currency?: unknown;
    };
    currency = typeof json.currency === "string" ? json.currency : null;
  } catch (error) {
    if (error instanceof MetaGraphError || error instanceof ApplyCallBudgetError) throw error;
    return metaWriteFailure(mutation, META_COULD_NOT_CONFIRM);
  }
  const refusal = metaCurrencyRefusal(currency);
  return refusal ? metaWriteFailure(mutation, refusal) : null;
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
    refuseMockPull(input.tokens, input.allowLive);
    if (input.tokens.mock) {
      return mockPull("meta", input.clientName);
    }
    return pullMetaLive(input.tokens, input.externalId);
  }

  async refreshTokens(tokens: StoredOAuthTokens): Promise<StoredOAuthTokens> {
    if (tokens.mock) return tokens;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new MetaRefreshError();
    let json: OauthTokenJson;
    try {
      json = await requestOauthToken(
        {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: tokens.accessToken,
        },
        META_REFRESH_FAILED,
      );
    } catch (error) {
      if (error instanceof MetaGraphError) throw error;
      throw new MetaRefreshError();
    }
    if (!json.access_token || !json.expires_in) throw new MetaRefreshError();
    const granted = grantedScopesFrom(json);
    return {
      ...tokens,
      accessToken: json.access_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      tokenType: "long_lived_user",
      ...(granted ? { grantedScopes: granted } : {}),
    };
  }

  async exchangeCode(code: string): Promise<ConnectorExchangeResult> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error(META_CONNECT_INCOMPLETE);
    let shortLived: OauthTokenJson;
    try {
      shortLived = await requestOauthToken(
        {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: metaRedirectUri(),
          code,
        },
        META_CONNECT_INCOMPLETE,
      );
    } catch {
      throw new Error(META_CONNECT_INCOMPLETE);
    }
    if (!shortLived.access_token) throw new Error(META_CONNECT_INCOMPLETE);

    let longLived: OauthTokenJson;
    try {
      longLived = await requestOauthToken(
        {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLived.access_token,
        },
        META_CONNECT_EXTEND_FAILED,
      );
    } catch {
      throw new Error(META_CONNECT_EXTEND_FAILED);
    }
    if (!longLived.access_token || !longLived.expires_in) throw new Error(META_CONNECT_EXTEND_FAILED);

    const granted = grantedScopesFrom(longLived) ?? grantedScopesFrom(shortLived);
    let externalId = "pending";
    try {
      const me = (await graphGet("me/adaccounts?fields=id,account_id", longLived.access_token)) as {
        data?: { id?: string; account_id?: string }[];
      };
      externalId = me.data?.[0]?.id ?? me.data?.[0]?.account_id ?? "pending";
    } catch {
      externalId = "pending";
    }
    return {
      tokens: {
        accessToken: longLived.access_token,
        expiresAt: new Date(Date.now() + longLived.expires_in * 1000).toISOString(),
        tokenType: "long_lived_user",
        scopes: ["ads_read", "ads_management"],
        ...(granted ? { grantedScopes: granted } : {}),
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
    const fields = metaLiveReadFields(mutation);
    const json = (await graphGet(
      `${mutation.target.externalId}?fields=${fields}`,
      tokens.accessToken,
      input.signal ?? requirePlatformSignal(input.deadlineAt),
    )) as {
      id?: string;
      status?: string;
      daily_budget?: string;
      bid_amount?: string;
      account_id?: string | number;
    };
    return {
      externalId: json.id ?? mutation.target.externalId,
      entityType: mutation.target.entityType,
      status: (json.status ?? "unknown").toLowerCase(),
      dailyBudget: json.daily_budget ? Number(json.daily_budget) / 100 : null,
      bidAmount: json.bid_amount ? Number(json.bid_amount) / 100 : null,
      accountId: normalizeMetaAccountId(json.account_id),
    };
  }

  async applyLive(input: ConnectorApplyInput): Promise<MutationOutcome> {
    const { tokens, mutation, live } = input;
    const inputRefusal = metaWriteInputRefusal(mutation);
    if (inputRefusal) return inputRefusal;
    const confirmed = metaLiveConfirmRefusal({
      mutation,
      live,
      accountExternalId: input.accountExternalId,
    });
    if (confirmed) return confirmed;
    const id = mutation.target.externalId.trim();
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
    if (mutation.action === "update_budget" || mutation.action === "update_bid") {
      const currencyRefusal = await metaCurrencyWriteRefusal(input);
      if (currencyRefusal) return currencyRefusal;
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
      const copy = metaCreateCopy(mutation.payload);
      if (!copy) {
        return {
          action: mutation.action,
          platform: "meta",
          target: mutation.target,
          status: "failed",
          mode: "live",
          writes: false,
          reason: META_COULD_NOT_CONFIRM,
        };
      }
      const { name, message, pageId, link, headline } = copy;
      const imageUrl = typeof mutation.payload.imageUrl === "string" ? mutation.payload.imageUrl : null;
      const accountId = input.accountExternalId.replace(/^act_/, "");
      const creative = (await graphPost(`act_${accountId}/adcreatives`, tokens.accessToken, {
        name: `${name} creative`,
        object_story_spec: JSON.stringify({
          page_id: pageId,
          link_data: {
            message,
            name: headline,
            link,
            ...(imageUrl ? { picture: imageUrl } : {}),
          },
        }),
      }, requirePlatformSignal(input.deadlineAt))) as { id?: string };
      const created = (await graphPost(`act_${accountId}/ads`, tokens.accessToken, {
        name,
        adset_id: id,
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
      const placement = metaTextField(mutation.payload, ["placement"]);
      if (!placement) {
        return {
          action: mutation.action,
          platform: "meta",
          target: mutation.target,
          status: "failed",
          mode: "live",
          writes: false,
          reason: META_COULD_NOT_CONFIRM,
        };
      }
      await graphPost(id, tokens.accessToken, {
        targeting: JSON.stringify({ publisher_platforms: ["facebook", "instagram"].filter((p) => p !== placement) }),
      }, requirePlatformSignal(input.deadlineAt));
      return { action: mutation.action, platform: "meta", target: mutation.target, status: "applied", mode: "live", writes: true };
    }
    throw new Error(`Meta mutation ${mutation.action} is not implemented`);
  }
}

export const metaAdPlatformConnector = new MetaAdPlatformConnector();

export type MetaConnectionCheck = {
  state: "connected" | "expiring" | "needs_reconnect" | "limited" | "rate_limited" | "not_configured" | "error";
  code: string | null;
  message: string;
  checkedAt: string;
  expiresAt: string | null;
  retry: boolean;
};

/**
 * Cheap read for Scheduled Jobs J10. No writes.
 * A stored expiresAt in the past is Needs reconnect without a Graph call.
 * A successful read with expiresAt inside 14 days is expiring, and the token still works.
 */
export async function checkMetaConnection(
  tokens: StoredOAuthTokens,
  now = new Date(),
): Promise<MetaConnectionCheck> {
  const checkedAt = now.toISOString();
  const expiresAt = tokens.expiresAt ?? null;
  if (tokens.mock) {
    return {
      state: "connected",
      code: null,
      message: "Test connection.",
      checkedAt,
      expiresAt,
      retry: false,
    };
  }
  if (!isMetaConfigured()) {
    return {
      state: "not_configured",
      code: "meta.not_configured",
      message: "Meta isn't set up on this server yet.",
      checkedAt,
      expiresAt,
      retry: false,
    };
  }
  const band = metaExpiryBand(expiresAt, now.getTime());
  if (band === "expired") {
    return {
      state: "needs_reconnect",
      code: META_TOKEN_EXPIRED,
      message: META_RECONNECT_MESSAGE,
      checkedAt,
      expiresAt,
      retry: false,
    };
  }
  try {
    await graphGet("me?fields=id", tokens.accessToken);
  } catch (error) {
    if (error instanceof MetaGraphError && error.metaCode === META_TOKEN_EXPIRED) {
      return {
        state: "needs_reconnect",
        code: META_TOKEN_EXPIRED,
        message: META_RECONNECT_MESSAGE,
        checkedAt,
        expiresAt,
        retry: false,
      };
    }
    if (error instanceof MetaGraphError && error.metaCode === META_RATE_LIMITED) {
      return {
        state: "rate_limited",
        code: META_RATE_LIMITED,
        message: META_RATE_LIMIT_MESSAGE,
        checkedAt,
        expiresAt,
        retry: true,
      };
    }
    if (error instanceof MetaGraphError && error.metaCode === META_PERMISSION_MISSING) {
      return {
        state: "limited",
        code: META_PERMISSION_MISSING,
        message: META_PERMISSION_MESSAGE,
        checkedAt,
        expiresAt,
        retry: false,
      };
    }
    return {
      state: "error",
      code: null,
      message: "Meta didn't answer. Cerevex will try again later.",
      checkedAt,
      expiresAt,
      retry: true,
    };
  }
  if (band === "expiring" && expiresAt) {
    return {
      state: "expiring",
      code: null,
      message: metaExpiringMessage(expiresAt),
      checkedAt,
      expiresAt,
      retry: false,
    };
  }
  return {
    state: "connected",
    code: null,
    message: "Connected.",
    checkedAt,
    expiresAt,
    retry: false,
  };
}
