import { and, eq } from "drizzle-orm";
import { bidMutationsEnabled, budgetMutationsEnabled } from "./flags";
import { isCreateNewMutationAction, isExecutableMutationAction } from "./mutations";
import { loadTokens } from "./credentials";
import { getDb } from "./db";
import { isGoogleConfigured, isMetaConfigured } from "./oauth";
import { adEntities } from "./schema";
import type { ApplyMutation } from "./audit-schemas";
import type { Platform, StoredOAuthTokens } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

export type MutationOutcome = {
  action: string;
  platform: Platform;
  target: { entityType: string; externalId: string; name?: string };
  status: "applied" | "skipped" | "already_applied" | "failed";
  mode: "mock" | "live";
  reason?: string;
  writes: boolean;
};

export type LiveEntityState = {
  externalId: string;
  entityType: string;
  status: string;
  dailyBudget?: number | null;
  bidAmount?: number | null;
};

function percentOf(current: number | null | undefined, payload: Record<string, unknown>): number | null {
  const absolute = typeof payload.amount === "number" ? payload.amount : Number(payload.amount);
  if (Number.isFinite(absolute) && absolute > 0) return absolute;
  const percent = typeof payload.percent === "number" ? payload.percent : Number(payload.percent);
  if (!Number.isFinite(percent) || current == null || current <= 0) return null;
  return Math.max(0, current * (1 + percent / 100));
}

function liveAllowed(platform: Platform, tokens: StoredOAuthTokens | null): boolean {
  if (!tokens || tokens.mock) return false;
  if (process.env.PLATFORM_SYNC_LIVE === "0") return false;
  return platform === "meta" ? isMetaConfigured() : isGoogleConfigured();
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

export async function readLiveEntityState(input: {
  platform: Platform;
  tokens: StoredOAuthTokens;
  mutation: ApplyMutation;
}): Promise<LiveEntityState | null> {
  if (input.tokens.mock) return null;
  const { mutation, tokens } = input;
  if (input.platform === "meta") {
    const fields =
      mutation.target.entityType === "campaign"
        ? "id,name,status,daily_budget"
        : "id,name,status,bid_amount";
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

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return null;
  const customerId = mutation.target.externalId.includes("/")
    ? mutation.target.externalId.split("/")[1]
    : undefined;
  // Entity-level live re-check uses the campaign/ad group resource name when present.
  const resource = mutation.target.externalId;
  const query =
    mutation.target.entityType === "campaign"
      ? `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${resource} LIMIT 1`
      : `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.id = ${resource} LIMIT 1`;
  const customer = customerId ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "";
  if (!customer) return null;
  const res = await fetch(`https://googleads.googleapis.com/v17/customers/${customer.replace(/-/g, "")}/googleAds:search`, {
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

async function applyMockMutation(
  adAccountId: string,
  mutation: ApplyMutation,
): Promise<MutationOutcome> {
  const db = getDb();
  const entity = await db.query.adEntities.findFirst({
    where: and(
      eq(adEntities.adAccountId, adAccountId),
      eq(adEntities.externalId, mutation.target.externalId),
    ),
  });

  if (mutation.action === "pause") {
    if (entity && ["paused", "paused"].includes(entity.status.toLowerCase())) {
      return {
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "already_applied",
        mode: "mock",
        writes: false,
        reason: "Already paused in local tables.",
      };
    }
    if (entity) {
      await db
        .update(adEntities)
        .set({
          status: "paused",
          rawJson: { ...(entity.rawJson as Record<string, unknown>), lastMutation: "pause", source: "m5-apply-mock" },
        })
        .where(eq(adEntities.id, entity.id));
    }
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "applied",
      mode: "mock",
      writes: true,
      reason: "Mock apply updated local entity status. No live platform call.",
    };
  }

  if (entity) {
    await db
      .update(adEntities)
      .set({
        rawJson: {
          ...(entity.rawJson as Record<string, unknown>),
          lastMutation: mutation.action,
          lastPayload: mutation.payload,
          source: "m5-apply-mock",
        },
      })
      .where(eq(adEntities.id, entity.id));
  }

  return {
    action: mutation.action,
    platform: mutation.platform,
    target: mutation.target,
    status: "applied",
    mode: "mock",
    writes: true,
    reason: `Mock apply recorded ${mutation.action}. No live platform call.`,
  };
}

async function applyMetaLive(
  tokens: StoredOAuthTokens,
  mutation: ApplyMutation,
  live: LiveEntityState | null,
): Promise<MutationOutcome> {
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

async function applyGoogleLive(
  tokens: StoredOAuthTokens,
  mutation: ApplyMutation,
  live: LiveEntityState | null,
  accountExternalId: string,
): Promise<MutationOutcome> {
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

  const res = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:mutate`, {
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

export function classifyMutation(mutation: ApplyMutation): MutationOutcome | null {
  if (isCreateNewMutationAction(mutation.action) || mutation.action === "review") {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason:
        mutation.action === "review"
          ? "Review-only mutation. No platform write."
          : "Create-new entity path is out of M5 scope. Skipped — not applied.",
    };
  }
  if (!isExecutableMutationAction(mutation.action)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: `Mutation class ${mutation.action} is not executable under Approve.`,
    };
  }
  if (mutation.action === "update_bid" && !bidMutationsEnabled()) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Bid mutations are rolled back (FEATURE_BID_MUTATIONS off).",
    };
  }
  if (mutation.action === "update_budget" && !budgetMutationsEnabled()) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Budget mutations are rolled back (FEATURE_BUDGET_MUTATIONS off).",
    };
  }
  return null;
}

export async function executeMutation(input: {
  adAccountId: string;
  platform: Platform;
  accountExternalId: string;
  mutation: ApplyMutation;
}): Promise<MutationOutcome> {
  const skipped = classifyMutation(input.mutation);
  if (skipped) return skipped;

  const tokens = await loadTokens(input.adAccountId);
  if (!tokens) {
    return {
      action: input.mutation.action,
      platform: input.platform,
      target: input.mutation.target,
      status: "failed",
      mode: "mock",
      writes: false,
      reason: "No OAuth credentials for this ad account.",
    };
  }

  if (!liveAllowed(input.platform, tokens)) {
    return applyMockMutation(input.adAccountId, input.mutation);
  }

  const live = await readLiveEntityState({
    platform: input.platform,
    tokens,
    mutation: input.mutation,
  }).catch(() => null);

  if (input.platform === "meta") {
    return applyMetaLive(tokens, input.mutation, live);
  }
  return applyGoogleLive(tokens, input.mutation, live, input.accountExternalId);
}
