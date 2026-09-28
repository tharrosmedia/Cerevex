/**
 * In market Brief 1.0 — read-only live inventory.
 *
 * Recently paused: there is no paused-at column. When a platform timestamp is
 * present (`pausedAt`, `updated_time`, or the same keys in raw JSON) it is the
 * clock, compared to a fixed 7-day lookback. Meta sync stores Graph
 * `updated_time`, which moves on any edit, not only a status change. If that
 * timestamp is missing, a paused row is included only when `syncedAt` falls
 * inside the same 7 days (last sync stood in for pause time). The results
 * window (today / 7d / 14d / 30d) does not change the lookback.
 *
 * Key results reuse cockpit cost-per-result (spend ÷ conversions) and click rate.
 */

export const IN_MARKET_CAPABILITY_ID = "in_market" as const;

export const IN_MARKET_LOOKBACK_DAYS = 7;
export const IN_MARKET_LOOKBACK_MS = IN_MARKET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
export const IN_MARKET_CAMPAIGN_CAP = 200;

export const IN_MARKET_WINDOWS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "30d", label: "Last 30 days" },
] as const;

export type InMarketWindowId = (typeof IN_MARKET_WINDOWS)[number]["id"];
export const IN_MARKET_DEFAULT_WINDOW: InMarketWindowId = "7d";

export const IN_MARKET_PLATFORMS = ["meta", "google"] as const;
export type InMarketPlatform = (typeof IN_MARKET_PLATFORMS)[number];

export const IN_MARKET_HELPER =
  "To change something that's running, use Recommendations, then Approve.";
export const IN_MARKET_LOAD_ERROR = "Couldn't load live inventory. Try again.";
export const IN_MARKET_EMPTY_META = "Nothing is running on Meta right now.";
export const IN_MARKET_EMPTY_GOOGLE = "Nothing is running on Google right now.";
export const IN_MARKET_CONNECT_GOOGLE = "Connect Google Ads in Settings to see what's live.";
export const IN_MARKET_CONNECT_META = "Connect Meta in Settings to see what's live.";
export const IN_MARKET_OPEN_META = "Open in Meta";
export const IN_MARKET_OPEN_GOOGLE = "Open in Google Ads";

export type InMarketChipKind = "Active" | "Paused" | "Limited" | "Off" | "Unknown";
export type InMarketPauseClock = "updated_time" | "synced_at";

const ACTIVE_STATUSES = new Set(["active", "enabled", "eligible"]);
const LIMITED_STATUSES = new Set([
  "limited",
  "learning_limited",
  "learning-limited",
  "budget_limited",
  "limited_by_budget",
  "with_issues",
]);
const OFF_STATUSES = new Set(["archived", "deleted", "removed", "ended", "completed", "off"]);
const PAUSE_TIME_KEYS = [
  "pausedAt",
  "paused_at",
  "statusChangedAt",
  "status_changed_at",
  "updatedTime",
  "updated_time",
] as const;

export function parseInMarketWindow(value: string | null | undefined): InMarketWindowId {
  if (value === "today" || value === "7d" || value === "14d" || value === "30d") return value;
  return IN_MARKET_DEFAULT_WINDOW;
}

export function inMarketEmptyCopy(platform: InMarketPlatform): string {
  return platform === "google" ? IN_MARKET_EMPTY_GOOGLE : IN_MARKET_EMPTY_META;
}

export function inMarketConnectCopy(platform: InMarketPlatform): string {
  return platform === "google" ? IN_MARKET_CONNECT_GOOGLE : IN_MARKET_CONNECT_META;
}

export function finiteNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Cockpit CPA: spend ÷ conversions. Zero conversions with spend is Infinity (audit "no results"). */
export function cockpitCostPerResultUsd(
  spendUsd: string | number | null | undefined,
  conversions: string | number | null | undefined,
): number | null {
  const spend = finiteNumber(spendUsd);
  const results = finiteNumber(conversions);
  if (results <= 0) return spend > 0 ? Number.POSITIVE_INFINITY : null;
  return spend / results;
}

/** Cockpit click rate: clicks ÷ impressions, or 0 when there are no impressions. */
export function cockpitClickRate(clicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return clicks / impressions;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function inMarketChip(status: string): { chip: InMarketChipKind; label: string } {
  const raw = status.trim();
  const key = normalizeStatus(raw);
  if (!key) return { chip: "Unknown", label: "Unknown" };
  if (ACTIVE_STATUSES.has(key)) return { chip: "Active", label: "Active" };
  if (key === "paused" || key.endsWith("_paused")) return { chip: "Paused", label: "Paused" };
  if (LIMITED_STATUSES.has(key) || key.includes("limited")) return { chip: "Limited", label: "Limited" };
  if (OFF_STATUSES.has(key)) return { chip: "Off", label: "Off" };
  const shortened = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
  return { chip: "Unknown", label: shortened || "Unknown" };
}

export function readStatusTimestamp(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  for (const key of PAUSE_TIME_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value > 1_000_000_000_000 ? value : value * 1000;
      return new Date(ms).toISOString();
    }
  }
  return null;
}

function deliveryStatus(status: string, raw: Record<string, unknown> | null | undefined): string {
  const effective = raw?.effectiveStatus ?? raw?.effective_status;
  if (typeof effective === "string" && effective.trim()) return effective;
  return status;
}

export function inMarketLevelLabel(platform: InMarketPlatform, entityType: string): string | null {
  if (entityType === "campaign") return "Campaign";
  if (entityType === "adset" && platform === "meta") return "Ad set";
  if (entityType === "ad_group" && platform === "google") return "Ad group";
  if (entityType === "ad") return "Ad";
  return null;
}

function platformDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = value.trim().replace(/^act_/, "").replace(/^customers\//, "");
  return /^\d+$/.test(stripped) ? stripped : null;
}

export function inMarketDeepLink(input: {
  platform: InMarketPlatform;
  accountExternalId: string;
  entityType: string;
  externalId: string;
  parentExternalId?: string | null;
  campaignExternalId?: string | null;
}): { href: string; label: string } | null {
  const id = platformDigits(input.externalId);
  if (!id) return null;
  if (input.platform === "meta") {
    const act = platformDigits(input.accountExternalId);
    if (!act) return null;
    if (input.entityType === "campaign") {
      return {
        href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${id}`,
        label: IN_MARKET_OPEN_META,
      };
    }
    if (input.entityType === "adset") {
      return {
        href: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}&selected_adset_ids=${id}`,
        label: IN_MARKET_OPEN_META,
      };
    }
    if (input.entityType === "ad") {
      return {
        href: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${id}`,
        label: IN_MARKET_OPEN_META,
      };
    }
    return null;
  }
  if (input.entityType === "campaign") {
    return {
      href: `https://ads.google.com/aw/campaigns?campaignId=${id}`,
      label: IN_MARKET_OPEN_GOOGLE,
    };
  }
  if (input.entityType === "ad_group") {
    const campaignId = platformDigits(input.campaignExternalId ?? input.parentExternalId);
    if (!campaignId) return null;
    return {
      href: `https://ads.google.com/aw/adgroups?campaignId=${campaignId}&adGroupId=${id}`,
      label: IN_MARKET_OPEN_GOOGLE,
    };
  }
  if (input.entityType === "ad") {
    const adGroupId = platformDigits(input.parentExternalId);
    const campaignId = platformDigits(input.campaignExternalId);
    if (!adGroupId || !campaignId) return null;
    return {
      href: `https://ads.google.com/aw/ads?campaignId=${campaignId}&adGroupId=${adGroupId}&adId=${id}`,
      label: IN_MARKET_OPEN_GOOGLE,
    };
  }
  return null;
}

export function inMarketRelativeTime(thenMs: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - thenMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < 45_000) return "just now";
  if (delta < 90_000) return "1 minute ago";
  if (delta < 45 * minute) return `${Math.round(delta / minute)} minutes ago`;
  if (delta < 90 * minute) return "1 hour ago";
  if (delta < 24 * hour) return `${Math.round(delta / hour)} hours ago`;
  if (delta < 36 * hour) return "1 day ago";
  return `${Math.round(delta / day)} days ago`;
}

export function inMarketStaleLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return `Last updated ${inMarketRelativeTime(then, now.getTime())}.`;
}

export type InMarketSourceAccount = {
  id: string;
  platform: InMarketPlatform;
  externalId: string;
  displayName?: string | null;
  connectionStatus: string;
  lastSyncAt?: string | null;
  hasCredentials: boolean;
};

export type InMarketSourceEntity = {
  id: string;
  adAccountId: string;
  platform: InMarketPlatform;
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId?: string | null;
  syncedAt: string;
  raw?: Record<string, unknown> | null;
};

export type InMarketSourceMetric = {
  entityId: string;
  window: string;
  spendUsd: string;
  impressions: number;
  clicks: number;
  conversions: string;
};

export type InMarketMetrics = {
  hasMetrics: boolean;
  spendUsd: string | null;
  resultCount: string | null;
  costUsd: string | null;
  impressions: number | null;
  clicks: number | null;
  clickRate: number | null;
  resultLabel: string;
  costLabel: string;
};

export type InMarketNode = {
  id: string;
  entityType: string;
  levelLabel: string;
  externalId: string;
  name: string;
  chip: InMarketChipKind;
  chipLabel: string;
  metrics: InMarketMetrics;
  deepLink: string | null;
  deepLinkLabel: string | null;
  children: InMarketNode[];
};

export type InMarketAccountSection = {
  id: string;
  name: string;
  campaigns: InMarketNode[];
  truncated: boolean;
};

export type InMarketPlatformSection = {
  platform: InMarketPlatform;
  label: "Meta" | "Google";
  emptyCopy: string;
  staleLabel: string | null;
  accounts: InMarketAccountSection[];
  empty: boolean;
};

export type InMarketPauseClockSummary = InMarketPauseClock | "mixed" | "none";

export type InMarketView = {
  visible: true;
  window: InMarketWindowId;
  lookbackDays: number;
  pauseClock: InMarketPauseClockSummary;
  helper: string;
  platforms: InMarketPlatformSection[];
};

export function isInMarketAccountConnected(account: {
  connectionStatus: string;
  hasCredentials: boolean;
}): boolean {
  return (
    account.connectionStatus === "connected" ||
    account.connectionStatus === "syncing" ||
    account.hasCredentials
  );
}

type RowDecision = { include: boolean; clock: InMarketPauseClock | null; chip: ReturnType<typeof inMarketChip>; status: string };

function decideRow(entity: InMarketSourceEntity, nowMs: number): RowDecision {
  const raw = entity.raw ?? {};
  const status = deliveryStatus(entity.status, raw);
  const chip = inMarketChip(status);
  if (chip.chip === "Active") return { include: true, clock: null, chip, status };
  if (chip.chip !== "Paused") return { include: false, clock: null, chip, status };
  const stamped = readStatusTimestamp(raw);
  if (stamped) {
    const then = Date.parse(stamped);
    const include = Number.isFinite(then) && then <= nowMs && nowMs - then <= IN_MARKET_LOOKBACK_MS;
    return { include, clock: "updated_time", chip, status };
  }
  const synced = Date.parse(entity.syncedAt);
  const include = Number.isFinite(synced) && synced <= nowMs && nowMs - synced <= IN_MARKET_LOOKBACK_MS;
  return { include, clock: "synced_at", chip, status };
}

function resultLabels(platform: InMarketPlatform): { resultLabel: string; costLabel: string } {
  if (platform === "google") {
    return { resultLabel: "Conversions", costLabel: "Cost per conversion" };
  }
  return { resultLabel: "Results", costLabel: "Cost per result" };
}

function metricsFor(
  platform: InMarketPlatform,
  metric: InMarketSourceMetric | undefined,
): InMarketMetrics {
  const labels = resultLabels(platform);
  if (!metric) {
    return {
      hasMetrics: false,
      spendUsd: null,
      resultCount: null,
      costUsd: null,
      impressions: null,
      clicks: null,
      clickRate: null,
      ...labels,
    };
  }
  const cost = cockpitCostPerResultUsd(metric.spendUsd, metric.conversions);
  return {
    hasMetrics: true,
    spendUsd: metric.spendUsd,
    resultCount: metric.conversions,
    costUsd: cost != null && Number.isFinite(cost) ? cost.toFixed(2) : null,
    impressions: metric.impressions,
    clicks: metric.clicks,
    clickRate: cockpitClickRate(metric.clicks, metric.impressions),
    ...labels,
  };
}

function latestIso(values: Array<string | null | undefined>): string | null {
  let best: number | null = null;
  let iso: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (best == null || ms > best) {
      best = ms;
      iso = value;
    }
  }
  return iso;
}

export function buildInMarketView(input: {
  accounts: InMarketSourceAccount[];
  entities: InMarketSourceEntity[];
  metrics: InMarketSourceMetric[];
  window?: string | null;
  now?: Date;
}): InMarketView {
  const now = input.now ?? new Date();
  const window = parseInMarketWindow(input.window);
  const metricByEntity = new Map<string, InMarketSourceMetric>();
  for (const metric of input.metrics) {
    if (metric.window === window) metricByEntity.set(metric.entityId, metric);
  }

  const clocks = new Set<InMarketPauseClock>();
  const included = new Map<string, RowDecision>();
  for (const entity of input.entities) {
    const decision = decideRow(entity, now.getTime());
    if (!decision.include) continue;
    included.set(entity.id, decision);
    if (decision.clock) clocks.add(decision.clock);
  }

  const pauseClock: InMarketPauseClockSummary =
    clocks.size === 0 ? "none" : clocks.size > 1 ? "mixed" : [...clocks][0]!;

  const platforms: InMarketPlatformSection[] = [];
  for (const platform of IN_MARKET_PLATFORMS) {
    const accounts = input.accounts.filter(
      (account) => account.platform === platform && isInMarketAccountConnected(account),
    );
    if (accounts.length === 0) continue;
    const sections: InMarketAccountSection[] = accounts.map((account) => {
      const mine = input.entities.filter((entity) => entity.adAccountId === account.id && included.has(entity.id));
      const byExternal = new Map(mine.map((entity) => [entity.externalId, entity]));
      const campaigns = mine
        .filter((entity) => entity.entityType === "campaign")
        .sort((a, b) => a.name.localeCompare(b.name));
      const truncated = campaigns.length > IN_MARKET_CAMPAIGN_CAP;
      const visibleCampaigns = campaigns.slice(0, IN_MARKET_CAMPAIGN_CAP);
      return {
        id: account.id,
        name: account.displayName?.trim() || account.externalId,
        truncated,
        campaigns: visibleCampaigns.map((campaign) =>
          toNode(platform, account.externalId, campaign, mine, byExternal, included, metricByEntity, null),
        ),
      };
    });
    const empty = sections.every((section) => section.campaigns.length === 0);
    const staleLabel = inMarketStaleLabel(
      latestIso([
        ...accounts.map((account) => account.lastSyncAt),
        ...input.entities
          .filter((entity) => entity.platform === platform && accounts.some((account) => account.id === entity.adAccountId))
          .map((entity) => entity.syncedAt),
      ]),
      now,
    );
    platforms.push({
      platform,
      label: platform === "google" ? "Google" : "Meta",
      emptyCopy: inMarketEmptyCopy(platform),
      staleLabel,
      accounts: sections,
      empty,
    });
  }

  return {
    visible: true,
    window,
    lookbackDays: IN_MARKET_LOOKBACK_DAYS,
    pauseClock,
    helper: IN_MARKET_HELPER,
    platforms,
  };
}

function toNode(
  platform: InMarketPlatform,
  accountExternalId: string,
  entity: InMarketSourceEntity,
  mine: InMarketSourceEntity[],
  byExternal: Map<string, InMarketSourceEntity>,
  included: Map<string, RowDecision>,
  metricByEntity: Map<string, InMarketSourceMetric>,
  campaignExternalId: string | null,
): InMarketNode {
  const decision = included.get(entity.id)!;
  const levelLabel = inMarketLevelLabel(platform, entity.entityType) ?? entity.entityType;
  const campaignId =
    entity.entityType === "campaign"
      ? entity.externalId
      : campaignExternalId ??
        (entity.parentExternalId ? byExternal.get(entity.parentExternalId)?.parentExternalId ?? null : null);
  const link = inMarketDeepLink({
    platform,
    accountExternalId,
    entityType: entity.entityType,
    externalId: entity.externalId,
    parentExternalId: entity.parentExternalId,
    campaignExternalId: entity.entityType === "ad" ? campaignId : entity.entityType === "ad_group" ? entity.parentExternalId : null,
  });
  const childType = entity.entityType === "campaign" ? (platform === "meta" ? "adset" : "ad_group") : entity.entityType === "ad" ? null : "ad";
  const children = childType
    ? mine
        .filter((child) => child.entityType === childType && child.parentExternalId === entity.externalId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) =>
          toNode(
            platform,
            accountExternalId,
            child,
            mine,
            byExternal,
            included,
            metricByEntity,
            entity.entityType === "campaign" ? entity.externalId : campaignId,
          ),
        )
    : [];
  return {
    id: entity.id,
    entityType: entity.entityType,
    levelLabel,
    externalId: entity.externalId,
    name: entity.name,
    chip: decision.chip.chip,
    chipLabel: decision.chip.label,
    metrics: metricsFor(platform, metricByEntity.get(entity.id)),
    deepLink: link?.href ?? null,
    deepLinkLabel: link?.label ?? null,
    children,
  };
}
