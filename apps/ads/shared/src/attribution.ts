/**
 * Browser-safe call / offline attribution joins.
 * Does not invent CPA, ROAS, or spend. Sentences stay plain language.
 */

export type AttributionCampaign = {
  entityType: string;
  externalId: string;
  name: string;
  platform?: "meta" | "google";
};

export type CallRecord = {
  id: string;
  startTime: string;
  answered: boolean;
  durationSeconds: number;
  source: string;
  campaign: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  trackingNumber?: string;
  customerPhoneLast4?: string;
  firstCall?: boolean;
  conversion?: boolean;
  valueUsd?: string | null;
  companyId?: string;
};

export type BookedJob = {
  id: string;
  status: "booked" | "completed" | "canceled";
  campaignHint?: string;
  customerPhoneLast4?: string;
  bookedAt: string;
  label: string;
};

export type CallJoin = {
  callId: string;
  sentence: string;
  campaignName?: string;
  campaignExternalId?: string;
  platform?: "meta" | "google";
  matchedOn: "campaign" | "utm" | "source" | "unmatched";
  answered: boolean;
  conversion: boolean;
  bookedJobLabel?: string;
  bookedJobId?: string;
};

export type AttributionSummary = {
  sentences: string[];
  joins: CallJoin[];
  answeredCount: number;
  conversionCount: number;
  bookedJoinCount: number;
  unmatchedCount: number;
};

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function tokens(value: string | undefined | null): string[] {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 2);
}

const PLATFORM_TOKENS = new Set(["google", "meta", "facebook", "instagram", "adwords"]);

function platformConflict(a: string, b: string): boolean {
  const left = new Set(tokens(a).filter((token) => PLATFORM_TOKENS.has(token)));
  const right = tokens(b).filter((token) => PLATFORM_TOKENS.has(token));
  if (left.size === 0 || right.length === 0) return false;
  return !right.some((token) => left.has(token));
}

function overlap(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (platformConflict(left, right)) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(tokens(left));
  const rightTokens = tokens(right);
  const shared = rightTokens.filter((token) => leftTokens.has(token));
  return shared.length >= 2;
}

function sourcePlatform(source: string, utmSource?: string): "meta" | "google" | null {
  const hay = `${source} ${utmSource ?? ""}`.toLowerCase();
  if (/\b(google|adwords|gclid)\b/.test(hay)) return "google";
  if (/\b(meta|facebook|instagram|fb)\b/.test(hay)) return "meta";
  return null;
}

export function joinCallToCampaigns(call: CallRecord, campaigns: AttributionCampaign[]): CallJoin {
  const byName = campaigns.find(
    (campaign) => campaign.entityType === "campaign" && overlap(campaign.name, call.campaign),
  );
  if (byName) {
    return {
      callId: call.id,
      sentence: `${call.answered ? "Answered" : "Missed"} call joined to ${byName.platform === "meta" ? "Meta" : byName.platform === "google" ? "Google" : "the"} campaign ${byName.name}.`,
      campaignName: byName.name,
      campaignExternalId: byName.externalId,
      platform: byName.platform,
      matchedOn: "campaign",
      answered: call.answered,
      conversion: Boolean(call.conversion),
    };
  }

  const byUtm = campaigns.find(
    (campaign) =>
      campaign.entityType === "campaign" &&
      Boolean(call.utmCampaign) &&
      overlap(campaign.name, call.utmCampaign ?? ""),
  );
  if (byUtm) {
    return {
      callId: call.id,
      sentence: `${call.answered ? "Answered" : "Missed"} call (UTM ${call.utmCampaign}) joined to campaign ${byUtm.name}.`,
      campaignName: byUtm.name,
      campaignExternalId: byUtm.externalId,
      platform: byUtm.platform,
      matchedOn: "utm",
      answered: call.answered,
      conversion: Boolean(call.conversion),
    };
  }

  const hinted = sourcePlatform(call.source, call.utmSource);
  const bySource = hinted
    ? campaigns.find((campaign) => campaign.entityType === "campaign" && campaign.platform === hinted)
    : undefined;
  if (bySource && campaigns.filter((campaign) => campaign.platform === hinted).length === 1) {
    return {
      callId: call.id,
      sentence: `${call.answered ? "Answered" : "Missed"} call from ${call.source || "ads"} joined to the only ${hinted === "meta" ? "Meta" : "Google"} campaign ${bySource.name}.`,
      campaignName: bySource.name,
      campaignExternalId: bySource.externalId,
      platform: bySource.platform,
      matchedOn: "source",
      answered: call.answered,
      conversion: Boolean(call.conversion),
    };
  }

  return {
    callId: call.id,
    sentence: `${call.answered ? "Answered" : "Missed"} call from ${call.source || "CallRail"} did not match a campaign name or UTM.`,
    matchedOn: "unmatched",
    answered: call.answered,
    conversion: Boolean(call.conversion),
  };
}

export function joinBookedJob(call: CallRecord, jobs: BookedJob[]): BookedJob | null {
  const open = jobs.filter((job) => job.status === "booked" || job.status === "completed");
  if (call.customerPhoneLast4) {
    const byPhone = open.find((job) => job.customerPhoneLast4 === call.customerPhoneLast4);
    if (byPhone) return byPhone;
  }
  if (call.campaign) {
    const byCampaign = open.find((job) => job.campaignHint && overlap(call.campaign, job.campaignHint));
    if (byCampaign) return byCampaign;
  }
  return null;
}

export function summarizeAttribution(input: {
  calls: CallRecord[];
  campaigns: AttributionCampaign[];
  bookedJobs?: BookedJob[];
  crmEnabled?: boolean;
}): AttributionSummary {
  const joins = input.calls.map((call) => {
    const join = joinCallToCampaigns(call, input.campaigns);
    if (input.crmEnabled) {
      const job = joinBookedJob(call, input.bookedJobs ?? []);
      if (job) {
        join.bookedJobId = job.id;
        join.bookedJobLabel = job.label;
        join.sentence = `${join.sentence} Soft-joined to booked job “${job.label}” — nothing was written back.`;
      }
    }
    return join;
  });

  const answeredCount = joins.filter((row) => row.answered).length;
  const conversionCount = joins.filter((row) => row.conversion).length;
  const bookedJoinCount = joins.filter((row) => row.bookedJobId).length;
  const unmatchedCount = joins.filter((row) => row.matchedOn === "unmatched").length;
  const grouped = new Map<string, { name: string; count: number }>();
  for (const join of joins) {
    if (!join.campaignName) continue;
    const current = grouped.get(join.campaignName) ?? { name: join.campaignName, count: 0 };
    current.count += 1;
    grouped.set(join.campaignName, current);
  }

  const sentences: string[] = [];
  if (input.calls.length === 0) {
    sentences.push("No CallRail calls were pulled yet.");
  } else {
    sentences.push(
      `${input.calls.length} call${input.calls.length === 1 ? "" : "s"} pulled. ${answeredCount} answered.`,
    );
    for (const row of grouped.values()) {
      sentences.push(`${row.count} call${row.count === 1 ? "" : "s"} joined to campaign ${row.name}.`);
    }
    if (conversionCount > 0) {
      sentences.push(
        `${conversionCount} of those ${conversionCount === 1 ? "is" : "are"} marked a conversion in CallRail.`,
      );
    }
    if (input.crmEnabled && bookedJoinCount > 0) {
      sentences.push(
        `${bookedJoinCount} call${bookedJoinCount === 1 ? "" : "s"} also match a booked job (recommend + join only).`,
      );
    }
    if (unmatchedCount > 0) {
      sentences.push(`${unmatchedCount} call${unmatchedCount === 1 ? "" : "s"} did not match a campaign name or UTM.`);
    }
  }

  return {
    sentences,
    joins,
    answeredCount,
    conversionCount,
    bookedJoinCount,
    unmatchedCount,
  };
}

export function mockCallRailCalls(clientName: string, now = new Date()): CallRecord[] {
  const stamp = now.toISOString();
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  return [
    {
      id: "cr-mock-1",
      startTime: hoursAgo(6),
      answered: true,
      durationSeconds: 184,
      source: "Google Ads",
      campaign: `${clientName} — Google HVAC leads`,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "hvac-leads",
      trackingNumber: "+1-555-0100",
      customerPhoneLast4: "1201",
      firstCall: true,
      conversion: true,
      valueUsd: null,
    },
    {
      id: "cr-mock-2",
      startTime: hoursAgo(18),
      answered: true,
      durationSeconds: 97,
      source: "Facebook Ads",
      campaign: `${clientName} — Meta HVAC leads`,
      utmSource: "facebook",
      utmMedium: "paid",
      utmCampaign: "hvac-leads",
      trackingNumber: "+1-555-0101",
      customerPhoneLast4: "4410",
      firstCall: true,
      conversion: false,
      valueUsd: null,
    },
    {
      id: "cr-mock-3",
      startTime: hoursAgo(30),
      answered: false,
      durationSeconds: 0,
      source: "Google Ads",
      campaign: "",
      utmSource: "google",
      utmCampaign: "hvac-leads",
      trackingNumber: "+1-555-0100",
      customerPhoneLast4: "7788",
      firstCall: true,
      conversion: false,
      valueUsd: null,
    },
    {
      id: "cr-mock-4",
      startTime: hoursAgo(40),
      answered: true,
      durationSeconds: 62,
      source: "Radio",
      campaign: "Saturday radio",
      trackingNumber: "+1-555-0199",
      customerPhoneLast4: "9090",
      firstCall: true,
      conversion: false,
      valueUsd: null,
    },
    {
      id: "cr-mock-5",
      startTime: stamp,
      answered: true,
      durationSeconds: 210,
      source: "Google Ads",
      campaign: `${clientName} — Google HVAC leads`,
      utmCampaign: "hvac-leads",
      trackingNumber: "+1-555-0100",
      customerPhoneLast4: "1201",
      firstCall: false,
      conversion: true,
      valueUsd: null,
    },
  ];
}

export function mockHcpBookedJobs(clientName: string, now = new Date()): BookedJob[] {
  return [
    {
      id: "hcp-mock-1",
      status: "booked",
      campaignHint: "HVAC leads",
      customerPhoneLast4: "1201",
      bookedAt: now.toISOString(),
      label: `${clientName} ductless install — booked`,
    },
  ];
}
