import type { Platform, StoredOAuthTokens } from "./types";

export type PulledEntity = {
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId?: string;
};

export type PulledMetric = {
  entityExternalId: string;
  entityType: string;
  window: "7d" | "30d";
  spendUsd: string;
  impressions: number;
  clicks: number;
  conversions: string;
};

export type PullResult = {
  mode: "mock" | "live";
  externalAccountId: string;
  entities: PulledEntity[];
  metrics: PulledMetric[];
};

const GRAPH = "https://graph.facebook.com/v21.0";

function mockPull(platform: Platform, clientName: string): PullResult {
  const prefix = platform === "meta" ? "act_mock" : "customers/mock";
  const campaignId = `${platform}-camp-1`;
  const groupType = platform === "meta" ? "adset" : "ad_group";
  const groupId = `${platform}-group-1`;
  const adId = `${platform}-ad-1`;
  const entities: PulledEntity[] = [
    {
      entityType: "campaign",
      externalId: campaignId,
      name: `${clientName} — ${platform === "meta" ? "Meta" : "Google"} HVAC leads`,
      status: "active",
    },
    {
      entityType: groupType,
      externalId: groupId,
      name: "Service area — ductless",
      status: "active",
      parentExternalId: campaignId,
    },
    {
      entityType: "ad",
      externalId: adId,
      name: "Tune-up offer",
      status: "active",
      parentExternalId: groupId,
    },
  ];
  if (platform === "google") {
    entities.push({
      entityType: "keyword",
      externalId: `${platform}-kw-1`,
      name: "ductless mini split install",
      status: "active",
      parentExternalId: groupId,
    });
  }
  const metrics: PulledMetric[] = entities
    .filter((e) => e.entityType === "campaign")
    .flatMap((e) => [
      {
        entityExternalId: e.externalId,
        entityType: e.entityType,
        window: "7d" as const,
        spendUsd: "412.50",
        impressions: 18420,
        clicks: 312,
        conversions: "9",
      },
      {
        entityExternalId: e.externalId,
        entityType: e.entityType,
        window: "30d" as const,
        spendUsd: "1688.00",
        impressions: 74210,
        clicks: 1288,
        conversions: "37",
      },
    ]);
  return { mode: "mock", externalAccountId: `${prefix}-${clientName.toLowerCase().replace(/\s+/g, "-")}`, entities, metrics };
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

async function pullMetaLive(tokens: StoredOAuthTokens, externalId: string): Promise<PullResult> {
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

  const entities: PulledEntity[] = [
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

  const metrics: PulledMetric[] = [];
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
        window: window === "last_7d" ? "7d" : "30d",
        spendUsd: row.spend ?? "0",
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: conversions?.value ?? "0",
      });
    }
  }

  return { mode: "live", externalAccountId: act, entities, metrics };
}

async function pullGoogleLive(tokens: StoredOAuthTokens, externalId: string): Promise<PullResult> {
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
  const res = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`, {
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
  return { mode: "live", externalAccountId: customerId, entities, metrics: [] };
}

export async function pullAdAccount(input: {
  platform: Platform;
  tokens: StoredOAuthTokens;
  externalId: string;
  clientName: string;
  allowLive: boolean;
}): Promise<PullResult> {
  if (input.tokens.mock || !input.allowLive) {
    return mockPull(input.platform, input.clientName);
  }
  if (input.platform === "meta") {
    return pullMetaLive(input.tokens, input.externalId);
  }
  return pullGoogleLive(input.tokens, input.externalId);
}

export async function refreshTokensIfNeeded(
  platform: Platform,
  tokens: StoredOAuthTokens,
): Promise<StoredOAuthTokens> {
  if (tokens.mock) return tokens;
  if (platform === "google" && tokens.refreshToken) {
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
  if (platform === "meta" && process.env.META_APP_ID && process.env.META_APP_SECRET) {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: tokens.accessToken,
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`);
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
  return tokens;
}

export { mockPull };
