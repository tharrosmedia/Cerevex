import {
  parseFindingDraft,
  parseRecommendationDraft,
  type FindingDraft,
  type ProposedMutation,
  type RecommendationDraft,
} from "./audit-schemas";
import type { BookedJob, CallRecord } from "./attribution";
import { summarizeAttribution } from "./attribution";
import type { Platform, RecommendationType } from "./types";

export const AUDIT_THRESHOLDS = {
  cpaHighUsd: 40,
  wasteSpendUsd: 100,
  lowCtr: 0.02,
  minImpressionsForCtr: 1000,
  thinKeywordCount: 3,
  concentrationShare: 0.8,
} as const;

export type AuditEntity = {
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId?: string | null;
};

export type AuditMetric = {
  entityExternalId: string;
  entityType: string;
  window: string;
  spendUsd: string;
  impressions: number;
  clicks: number;
  conversions: string;
};

export type EvaluateAccountInput = {
  workspaceId: string;
  clientId: string;
  auditRunId: string;
  adAccountId: string;
  platform: Platform;
  entities: AuditEntity[];
  metrics: AuditMetric[];
  offlineSignals?: {
    calls?: CallRecord[];
    bookedJobs?: BookedJob[];
    callrailEnabled?: boolean;
    bundledEnabled?: boolean;
    crmEnabled?: boolean;
    sourceLabel?: string;
  };
};

export type EvaluateAccountResult = {
  findings: FindingDraft[];
  recommendations: RecommendationDraft[];
};

function money(value: number): string {
  return value.toFixed(2);
}

function confidence(value: number): string {
  return Math.min(1, Math.max(0, value)).toFixed(4);
}

function num(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricFor(metrics: AuditMetric[], externalId: string, window: string): AuditMetric | undefined {
  return metrics.find((row) => row.entityExternalId === externalId && row.window === window);
}

function cpaUsd(row: AuditMetric): number | null {
  const conversions = num(row.conversions);
  const spend = num(row.spendUsd);
  if (conversions <= 0) return spend > 0 ? Infinity : null;
  return spend / conversions;
}

function ctr(row: AuditMetric): number {
  if (row.impressions <= 0) return 0;
  return row.clicks / row.impressions;
}

function mutation(
  platform: Platform,
  action: ProposedMutation["action"],
  entity: AuditEntity,
  payload: Record<string, unknown> = {},
): ProposedMutation {
  return {
    platform,
    action,
    target: { entityType: entity.entityType, externalId: entity.externalId, name: entity.name },
    payload,
    execute: false,
  };
}

function finding(
  input: EvaluateAccountInput,
  ruleId: string,
  severity: FindingDraft["severity"],
  title: string,
  extra: Record<string, unknown> = {},
): FindingDraft {
  return parseFindingDraft({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    auditRunId: input.auditRunId,
    severity,
    title,
    bodyJson: {
      ruleId,
      writes: false,
      adAccountId: input.adAccountId,
      platform: input.platform,
      ...extra,
    },
  });
}

function recommendation(
  input: EvaluateAccountInput,
  draft: {
    type: RecommendationType;
    ruleId: string;
    title: string;
    rationale: string;
    estimatedImpactUsd: string | null;
    risk: RecommendationDraft["risk"];
    confidence: string | null;
    evidence: Record<string, unknown>;
    mutations: ProposedMutation[];
  },
): RecommendationDraft {
  return parseRecommendationDraft({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    adAccountId: input.adAccountId,
    type: draft.type,
    title: draft.title,
    rationale: draft.rationale,
    estimatedImpactUsd: draft.estimatedImpactUsd,
    risk: draft.risk,
    confidence: draft.confidence,
    evidenceJson: {
      auditRunId: input.auditRunId,
      ruleId: draft.ruleId,
      writes: false,
      platform: input.platform,
      ...draft.evidence,
    },
    proposedMutationsJson: draft.mutations,
    status: "proposed",
    schemaVersion: "1",
  });
}

/**
 * Pure account evaluator. Reads already-synced entities/metrics only.
 * Never calls Meta or Google. Recommendations stay status=proposed.
 */
export function evaluateAccount(input: EvaluateAccountInput): EvaluateAccountResult {
  const findings: FindingDraft[] = [];
  const recommendations: RecommendationDraft[] = [];
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  const ads = input.entities.filter((entity) => entity.entityType === "ad");
  const keywords = input.entities.filter((entity) => entity.entityType === "keyword");
  const spend30 = input.metrics
    .filter((row) => row.window === "30d")
    .reduce((sum, row) => sum + num(row.spendUsd), 0);

  findings.push(
    finding(input, "account_snapshot", "info", `${input.platform} account snapshot (local tables only)`, {
      entityCount: input.entities.length,
      campaignCount: campaigns.length,
      spend30dUsd: money(spend30),
      source: "os.ad_entities",
    }),
  );

  if (input.entities.length === 0) {
    findings.push(
      finding(input, "no_entities", "info", "No synced entities — connect and sync before expecting recs", {
        hint: "Mock-connect + Sync now populates local tables without live spend.",
      }),
    );
    return { findings, recommendations };
  }

  for (const campaign of campaigns) {
    const m30 = metricFor(input.metrics, campaign.externalId, "30d");
    const m7 = metricFor(input.metrics, campaign.externalId, "7d");
    const childAds = ads.filter(
      (ad) => ad.parentExternalId === campaign.externalId || input.entities.some((group) => {
        const groupType = group.entityType === "adset" || group.entityType === "ad_group";
        return groupType && group.parentExternalId === campaign.externalId && ad.parentExternalId === group.externalId;
      }),
    );

    if (m30 && num(m30.spendUsd) >= AUDIT_THRESHOLDS.wasteSpendUsd && num(m30.conversions) <= 0) {
      findings.push(
        finding(input, "zero_conversion_spend", "high", `${campaign.name} spent with zero conversions (30d)`, {
          spend30dUsd: m30.spendUsd,
          conversions: m30.conversions,
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "pause_waste",
          ruleId: "zero_conversion_spend",
          title: `Propose pausing ${campaign.name} (waste)`,
          rationale: `30d spend $${m30.spendUsd} produced 0 conversions. Approve pauses this campaign. Deny or Snooze writes nothing.`,
          estimatedImpactUsd: money(num(m30.spendUsd) * 0.5),
          risk: "high",
          confidence: confidence(0.62),
          evidence: { entityExternalId: campaign.externalId, window: "30d", metrics: m30 },
          mutations: [
            mutation(input.platform, "pause", campaign, { reason: "zero_conversions" }),
            ...(input.platform === "google" && keywords[0]
              ? [mutation(input.platform, "add_negative", campaign, { text: "free estimate", reason: "waste" })]
              : input.platform === "meta"
                ? [mutation(input.platform, "exclude_placement", campaign, { placement: "audience_network" })]
                : []),
          ],
        }),
      );
    }

    const campaignCpa = m30 ? cpaUsd(m30) : null;
    if (m30 && campaignCpa !== null && campaignCpa > AUDIT_THRESHOLDS.cpaHighUsd && Number.isFinite(campaignCpa)) {
      findings.push(
        finding(input, "high_cpa", "medium", `${campaign.name} CPA $${campaignCpa.toFixed(2)} exceeds $${AUDIT_THRESHOLDS.cpaHighUsd}`, {
          cpa30dUsd: money(campaignCpa),
          spend30dUsd: m30.spendUsd,
          conversions: m30.conversions,
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "review_cpa",
          ruleId: "high_cpa",
          title: `Review bids/targeting on ${campaign.name}`,
          rationale: `30d CPA is $${campaignCpa.toFixed(2)}. Approve lowers bid 15% and budget 10% on this campaign.`,
          estimatedImpactUsd: money(num(m30.spendUsd) * 0.1),
          risk: "medium",
          confidence: confidence(0.71),
          evidence: { entityExternalId: campaign.externalId, window: "30d", cpaUsd: money(campaignCpa), metrics: m30 },
          mutations: [
            mutation(input.platform, "update_bid", campaign, { percent: -15, direction: "down" }),
            mutation(input.platform, "update_budget", campaign, { percent: -10, direction: "down" }),
          ],
        }),
      );
    }

    const ctrRow = m7 ?? m30;
    if (ctrRow && ctrRow.impressions >= AUDIT_THRESHOLDS.minImpressionsForCtr && ctr(ctrRow) < AUDIT_THRESHOLDS.lowCtr) {
      const rate = ctr(ctrRow);
      findings.push(
        finding(input, "low_ctr", "medium", `${campaign.name} CTR ${(rate * 100).toFixed(2)}% is below ${(AUDIT_THRESHOLDS.lowCtr * 100).toFixed(0)}%`, {
          window: ctrRow.window,
          ctr: Number(rate.toFixed(4)),
          impressions: ctrRow.impressions,
          clicks: ctrRow.clicks,
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "improve_ctr",
          ruleId: "low_ctr",
          title: `Refresh creative on ${campaign.name}`,
          rationale: `${ctrRow.window} CTR is ${(rate * 100).toFixed(2)}%. A new ad variant is proposed only — Approve will not create new ads in this slice.`,
          estimatedImpactUsd: money(num((m30 ?? ctrRow).spendUsd) * 0.05),
          risk: "low",
          confidence: confidence(0.58),
          evidence: { entityExternalId: campaign.externalId, window: ctrRow.window, ctr: Number(rate.toFixed(4)) },
          mutations: [
            mutation(input.platform, "create_ad", campaign, {
              proposedName: `${campaign.name} — variant B`,
            }),
          ],
        }),
      );
    }

    if (childAds.length === 1) {
      findings.push(
        finding(input, "single_ad", "low", `${campaign.name} has a single ad`, {
          adExternalId: childAds[0]?.externalId,
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "add_creative",
          ruleId: "single_ad",
          title: `Add a second ad to ${campaign.name}`,
          rationale: "A single creative is a concentration risk. Propose adding a variant. Not applied.",
          estimatedImpactUsd: null,
          risk: "low",
          confidence: confidence(0.64),
          evidence: { entityExternalId: campaign.externalId, adCount: 1 },
          mutations: [mutation(input.platform, "create_ad", childAds[0]!, { proposed: "variant_b" })],
        }),
      );
    }
  }

  if (input.platform === "google" && keywords.length > 0 && keywords.length < AUDIT_THRESHOLDS.thinKeywordCount) {
    findings.push(
      finding(input, "thin_keywords", "low", `Only ${keywords.length} keyword(s) synced`, {
        keywords: keywords.map((row) => row.name),
      }),
    );
    recommendations.push(
      recommendation(input, {
        type: "expand_keywords",
        ruleId: "thin_keywords",
        title: "Expand keyword coverage (propose only)",
        rationale: "Thin keyword sets miss HVAC intent. Propose adding related terms. No Google write.",
        estimatedImpactUsd: null,
        risk: "low",
        confidence: confidence(0.55),
        evidence: { keywordCount: keywords.length },
        mutations: [
          mutation(input.platform, "add_keyword", keywords[0]!, {
            proposedText: "ductless mini split repair",
          }),
        ],
      }),
    );
  }

  const offline = input.offlineSignals;
  const callTrackingOn = Boolean(offline?.callrailEnabled || offline?.bundledEnabled);
  if (offline && callTrackingOn && (offline.calls?.length ?? 0) > 0) {
    const sourceLabel = offline.sourceLabel ?? (offline.bundledEnabled && !offline.callrailEnabled ? "bundled call tracking" : "CallRail");
    const summary = summarizeAttribution({
      calls: offline.calls ?? [],
      campaigns: campaigns.map((campaign) => ({
        entityType: campaign.entityType,
        externalId: campaign.externalId,
        name: campaign.name,
        platform: input.platform,
      })),
      bookedJobs: offline.bookedJobs,
      crmEnabled: Boolean(offline.crmEnabled),
      sourceLabel,
    });
    const joined = summary.joins.filter((row) => row.matchedOn !== "unmatched");
    if (joined.length > 0) {
      const first = joined[0]!;
      const target =
        campaigns.find((campaign) => campaign.externalId === first.campaignExternalId) ?? campaigns[0];
      findings.push(
        finding(input, "call_attribution", "info", `${summary.answeredCount} answered calls joined to campaigns`, {
          hint: summary.sentences[0],
          callCount: offline.calls?.length ?? 0,
          answeredCount: summary.answeredCount,
          conversionCount: summary.conversionCount,
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "call_attribution",
          ruleId: "call_attribution",
          title: joined.length === 1 ? `Call joined to ${first.campaignName}` : "Calls joined to campaigns",
          rationale: summary.sentences.join(" "),
          estimatedImpactUsd: null,
          risk: "low",
          confidence: confidence(0.7),
          evidence: {
            source: offline.callrailEnabled ? "callrail" : "bundled",
            writes: false,
            sentences: summary.sentences,
            joinCount: joined.length,
            unmatchedCount: summary.unmatchedCount,
            conversionCount: summary.conversionCount,
          },
          mutations: target ? [mutation(input.platform, "review", target, { action: "call_attribution_review_only" })] : [],
        }),
      );
    }
    if (offline.crmEnabled && summary.bookedJoinCount > 0) {
      const booked = summary.joins.find((row) => row.bookedJobId);
      const target =
        campaigns.find((campaign) => campaign.externalId === booked?.campaignExternalId) ?? campaigns[0];
      findings.push(
        finding(input, "crm_booked_job", "info", "CallRail call soft-joined to a booked job", {
          hint: "Recommend + join only. Nothing was written to Housecall Pro.",
          bookedJoinCount: summary.bookedJoinCount,
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "crm_booked_job",
          ruleId: "crm_booked_job",
          title: booked?.bookedJobLabel
            ? `Booked job: ${booked.bookedJobLabel}`
            : "Call soft-joined to a booked job",
          rationale:
            "A CallRail call matches a Housecall Pro booked job. This is a join signal only — Cerevex did not write the CRM.",
          estimatedImpactUsd: null,
          risk: "low",
          confidence: confidence(0.6),
          evidence: {
            source: "hcp",
            writes: false,
            bookedJoinCount: summary.bookedJoinCount,
            bookedJobLabel: booked?.bookedJobLabel,
          },
          mutations: target ? [mutation(input.platform, "review", target, { action: "crm_join_review_only" })] : [],
        }),
      );
    }
  }

  if (campaigns.length === 1 && spend30 > 0) {
    const only = campaigns[0]!;
    const share = 1;
    if (share >= AUDIT_THRESHOLDS.concentrationShare) {
      findings.push(
        finding(input, "spend_concentration", "info", `All 30d spend sits on ${only.name}`, {
          share,
          spend30dUsd: money(spend30),
        }),
      );
      recommendations.push(
        recommendation(input, {
          type: "spend_concentration",
          ruleId: "spend_concentration",
          title: `Monitor concentration on ${only.name}`,
          rationale: "100% of pulled 30d spend is on one campaign. Do not shift budget unsupervised.",
          estimatedImpactUsd: null,
          risk: "medium",
          confidence: confidence(0.6),
          evidence: { entityExternalId: only.externalId, share },
          mutations: [mutation(input.platform, "review", only, { action: "do_not_autoshift_budget" })],
        }),
      );
    }
  }

  return { findings, recommendations };
}
