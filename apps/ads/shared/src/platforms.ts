import type { Platform } from "./types";

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

export function mockPull(platform: Platform, clientName: string): PullResult {
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
