import type { Platform } from "./types";

export type PulledEntity = {
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId?: string;
  raw?: Record<string, unknown>;
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

function metric(
  entity: PulledEntity,
  window: "7d" | "30d",
  spendUsd: string,
  impressions: number,
  clicks: number,
  conversions: string,
): PulledMetric {
  return {
    entityExternalId: entity.externalId,
    entityType: entity.entityType,
    window,
    spendUsd,
    impressions,
    clicks,
    conversions,
  };
}

export function mockPull(platform: Platform, clientName: string): PullResult {
  const prefix = platform === "meta" ? "act_mock" : "customers/mock";
  const campaignId = `${platform}-camp-1`;
  const campaignBId = `${platform}-camp-2`;
  const groupType = platform === "meta" ? "adset" : "ad_group";
  const groupId = `${platform}-group-1`;
  const groupBId = `${platform}-group-2`;
  const adId = `${platform}-ad-1`;
  const adBId = `${platform}-ad-2`;
  const landingMismatch = {
    url: "https://example.com/furnace-sale",
    title: "Furnace sale",
    headline: "Get 20% off a new furnace",
    body: "Replace your furnace this month and save 20%. Financing available.",
    offer: "20% off a new furnace",
  };
  const landingMatch = {
    url: "https://example.com/ductless-tune-up",
    title: "Ductless tune-up",
    headline: "Same-week ductless tune-up",
    body: "Factory-trained techs. Book a home visit for a ductless tune-up.",
    offer: "Tune-up from $89",
  };

  const campaignA: PulledEntity = {
    entityType: "campaign",
    externalId: campaignId,
    name: `${clientName} — ${platform === "meta" ? "Meta" : "Google"} HVAC leads`,
    status: "active",
  };
  const campaignB: PulledEntity = {
    entityType: "campaign",
    externalId: campaignBId,
    name: `${clientName} — ${platform === "meta" ? "Meta" : "Google"} furnace promo`,
    status: "active",
  };
  const entities: PulledEntity[] = [
    campaignA,
    campaignB,
    {
      entityType: groupType,
      externalId: groupId,
      name: "Service area — ductless",
      status: "active",
      parentExternalId: campaignId,
    },
    {
      entityType: groupType,
      externalId: groupBId,
      name: "Service area — furnace",
      status: "active",
      parentExternalId: campaignBId,
    },
    {
      entityType: "ad",
      externalId: adId,
      name: "Tune-up offer",
      status: "active",
      parentExternalId: groupId,
      raw: {
        headline: "Same-week ductless install. Book a free home visit.",
        body: "Factory-trained techs. Tune-up from $89.",
        offer: "Tune-up from $89",
        imageUrl: "https://picsum.photos/seed/cerevex-tuneup/640/640",
        landingPageUrl: landingMismatch.url,
        landingPage: landingMismatch,
      },
    },
    {
      entityType: "ad",
      externalId: adBId,
      name: "Furnace promo",
      status: "active",
      parentExternalId: groupBId,
      raw: {
        headline: "Furnace replacement this month",
        body: "Ask about financing on a new furnace.",
        offer: "20% off a new furnace",
        imageUrl: "https://picsum.photos/seed/cerevex-furnace/640/640",
        landingPageUrl: landingMatch.url,
        landingPage: landingMatch,
      },
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

  const metrics: PulledMetric[] = [
    metric(campaignA, "7d", "412.50", 18420, 312, "9"),
    metric(
      campaignA,
      "30d",
      "1688.00",
      74210,
      1288,
      platform === "google" ? "18" : "37",
    ),
    metric(
      campaignB,
      "7d",
      platform === "google" ? "640.00" : "510.00",
      9000,
      90,
      platform === "google" ? "2" : "4",
    ),
    metric(
      campaignB,
      "30d",
      platform === "google" ? "2200.00" : "2100.00",
      36000,
      360,
      platform === "google" ? "12" : "18",
    ),
    metric(entities[4]!, "7d", "180.00", 6200, 140, "4"),
    metric(entities[4]!, "30d", "720.00", 24800, 510, "16"),
    metric(entities[5]!, "7d", "90.00", 4100, 42, "1"),
    metric(entities[5]!, "30d", "380.00", 16400, 150, "4"),
  ];

  return {
    mode: "mock",
    externalAccountId: `${prefix}-${clientName.toLowerCase().replace(/\s+/g, "-")}`,
    entities,
    metrics,
  };
}
