/**
 * M5.1 client-level evaluator. Reads synced entities/metrics + optional funnel
 * and landing-page snapshots. Never calls Meta/Google. Recs stay proposed.
 */

import type { CapabilityFlags } from "@cerevex/contracts";
import { isBudgetShiftWritable, isCapabilityVisible } from "@cerevex/contracts";
import {
  parseFindingDraft,
  parseRecommendationDraft,
  type FindingDraft,
  type ProposedMutation,
  type RecommendationDraft,
} from "./audit-schemas";
import type { AuditEntity, AuditMetric, EvaluateAccountInput } from "./audit-engine";
import {
  analyzeCopySentiment,
  compareAdsInGroup,
  creativeFromRaw,
  otherPlatform,
  platformLabel,
  type AdCompareRow,
} from "./creative-analysis";
import { compareAdToLanding, landingFromCreative } from "./lp-congruence";
import { funnelStrengthFor, type FunnelSignal } from "./funnel";
import type { Platform, RecommendationType } from "./types";

export const M51_THRESHOLDS = {
  minSpendUsd: 50,
  cpaGapShare: 0.2,
  shiftPercent: 15,
} as const;

export type M51AccountSlice = {
  adAccountId: string;
  platform: Platform;
  entities: Array<AuditEntity & { raw?: Record<string, unknown> }>;
  metrics: AuditMetric[];
};

export type EvaluateClientM51Input = {
  workspaceId: string;
  clientId: string;
  auditRunId: string;
  accounts: M51AccountSlice[];
  capabilities: CapabilityFlags;
  funnel?: FunnelSignal | null;
};

export type EvaluateClientM51Result = {
  findings: FindingDraft[];
  recommendations: RecommendationDraft[];
};

function money(value: number): string {
  return Math.max(0, value).toFixed(2);
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
  if (conversions <= 0) return null;
  return spend / conversions;
}

function mutation(
  platform: Platform,
  action: ProposedMutation["action"],
  entity: { entityType: string; externalId: string; name: string },
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

/** Live budget mutations only when m51.budget_shift is on. recommend_only stays review. */
function budgetShiftMutations(
  writable: boolean,
  platform: Platform,
  rows: Array<{
    entity: { entityType: string; externalId: string; name: string };
    payload: Record<string, unknown>;
  }>,
): ProposedMutation[] {
  return rows.map((row) =>
    mutation(platform, writable ? "update_budget" : "review", row.entity, {
      ...row.payload,
      m51: "budget_shift",
      ...(writable ? {} : { action: "do_not_autoshift_budget" }),
    }),
  );
}

function finding(
  input: EvaluateClientM51Input,
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
      ...extra,
    },
  });
}

function recommendation(
  input: EvaluateClientM51Input,
  adAccountId: string,
  draft: {
    type: RecommendationType;
    ruleId: string;
    title: string;
    rationale: string;
    estimatedImpactUsd: string | null;
    risk: RecommendationDraft["risk"];
    confidence: string;
    evidence: Record<string, unknown>;
    mutations: ProposedMutation[];
  },
): RecommendationDraft {
  return parseRecommendationDraft({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    adAccountId,
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
      inbox: draft.type,
      ...draft.evidence,
    },
    proposedMutationsJson: draft.mutations,
    status: "proposed",
    schemaVersion: "1",
  });
}

type CampaignScore = {
  account: M51AccountSlice;
  campaign: M51AccountSlice["entities"][number];
  spend: number;
  conversions: number;
  cpa: number | null;
  metrics: AuditMetric;
};

function campaignScores(account: M51AccountSlice): CampaignScore[] {
  const campaigns = account.entities.filter((entity) => entity.entityType === "campaign");
  const out: CampaignScore[] = [];
  for (const campaign of campaigns) {
    const m30 = metricFor(account.metrics, campaign.externalId, "30d");
    if (!m30 || num(m30.spendUsd) < M51_THRESHOLDS.minSpendUsd) continue;
    out.push({
      account,
      campaign,
      spend: num(m30.spendUsd),
      conversions: num(m30.conversions),
      cpa: cpaUsd(m30),
      metrics: m30,
    });
  }
  return out;
}

function childAds(account: M51AccountSlice, campaignExternalId: string) {
  const ads = account.entities.filter((entity) => entity.entityType === "ad");
  return ads.filter((ad) => {
    if (ad.parentExternalId === campaignExternalId) return true;
    return account.entities.some((group) => {
      const groupType = group.entityType === "adset" || group.entityType === "ad_group";
      return groupType && group.parentExternalId === campaignExternalId && ad.parentExternalId === group.externalId;
    });
  });
}

export function evaluateClientM51(input: EvaluateClientM51Input): EvaluateClientM51Result {
  const findings: FindingDraft[] = [];
  const recommendations: RecommendationDraft[] = [];
  const allScores = input.accounts.flatMap(campaignScores);

  const budgetShiftOn = isBudgetShiftWritable(input.capabilities);
  if (isCapabilityVisible("m51.budget_shift", input.capabilities)) {
    for (const account of input.accounts) {
      const scores = campaignScores(account).filter((row) => row.cpa != null);
      if (scores.length < 2) continue;
      const ranked = [...scores].sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity));
      const winner = ranked[0]!;
      const loser = ranked[ranked.length - 1]!;
      if (!winner.cpa || !loser.cpa || winner.campaign.externalId === loser.campaign.externalId) continue;
      if (loser.cpa <= winner.cpa * (1 + M51_THRESHOLDS.cpaGapShare)) continue;
      const opportunity = loser.spend * (1 - winner.cpa / loser.cpa) * (M51_THRESHOLDS.shiftPercent / 100);
      const funnel = funnelStrengthFor(input.funnel, account.platform, winner.campaign.name);
      findings.push(
        finding(input, "budget_shift_gap", "medium", `Move spend toward ${winner.campaign.name}`, {
          adAccountId: account.adAccountId,
          platform: account.platform,
          winnerCpaUsd: money(winner.cpa),
          loserCpaUsd: money(loser.cpa),
          winnerSpendUsd: money(winner.spend),
          loserSpendUsd: money(loser.spend),
        }),
      );
      recommendations.push(
        recommendation(input, account.adAccountId, {
          type: "budget_shift",
          ruleId: "budget_shift_gap",
          title: `Shift budget toward ${winner.campaign.name}`,
          rationale: `${winner.campaign.name} brings a lead for $${winner.cpa.toFixed(2)}. ${loser.campaign.name} costs $${loser.cpa.toFixed(2)}. ${
            budgetShiftOn
              ? `Approve moves ${M51_THRESHOLDS.shiftPercent}% of the weaker campaign’s budget to the stronger one.`
              : "Budget shift is recommend-only here — Approve will not change spend."
          }${funnel.boosts && funnel.why ? ` ${funnel.why}` : ""} Deny and Snooze write nothing.`,
          estimatedImpactUsd: money(opportunity),
          risk: "medium",
          confidence: confidence(funnel.boosts ? 0.78 : 0.66),
          evidence: {
            platform: account.platform,
            inbox: "budget_shift",
            winnerExternalId: winner.campaign.externalId,
            loserExternalId: loser.campaign.externalId,
            winnerCpaUsd: money(winner.cpa),
            loserCpaUsd: money(loser.cpa),
            spend30dUsd: money(loser.spend),
            funnel: funnel.boosts ? input.funnel : undefined,
          },
          mutations: budgetShiftMutations(budgetShiftOn, account.platform, [
            {
              entity: loser.campaign,
              payload: { percent: -M51_THRESHOLDS.shiftPercent, direction: "down", reason: "shift_from_weaker" },
            },
            {
              entity: winner.campaign,
              payload: { percent: M51_THRESHOLDS.shiftPercent, direction: "up", reason: "shift_to_winner" },
            },
          ]),
        }),
      );
    }

    const byPlatform = new Map<Platform, CampaignScore[]>();
    for (const score of allScores) {
      const list = byPlatform.get(score.account.platform) ?? [];
      list.push(score);
      byPlatform.set(score.account.platform, list);
    }
    if (byPlatform.has("meta") && byPlatform.has("google")) {
      const bestOf = (platform: Platform) => {
        const rows = (byPlatform.get(platform) ?? []).filter((row) => row.cpa != null);
        return [...rows].sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity))[0];
      };
      const metaBest = bestOf("meta");
      const googleBest = bestOf("google");
      if (metaBest?.cpa && googleBest?.cpa && metaBest.cpa !== googleBest.cpa) {
        const winner = metaBest.cpa < googleBest.cpa ? metaBest : googleBest;
        const loser = winner === metaBest ? googleBest : metaBest;
        if (loser.cpa! > winner.cpa! * (1 + M51_THRESHOLDS.cpaGapShare)) {
          const opportunity = loser.spend * (1 - winner.cpa! / loser.cpa!) * (M51_THRESHOLDS.shiftPercent / 100);
          const funnel = funnelStrengthFor(input.funnel, winner.account.platform, winner.campaign.name);
          findings.push(
            finding(input, "budget_shift_cross_platform", "medium", `Winning platform is ${platformLabel(winner.account.platform)}`, {
              winnerPlatform: winner.account.platform,
              loserPlatform: loser.account.platform,
              winnerCpaUsd: money(winner.cpa!),
              loserCpaUsd: money(loser.cpa!),
            }),
          );
          recommendations.push(
            recommendation(input, loser.account.adAccountId, {
              type: "budget_shift",
              ruleId: "budget_shift_cross_platform",
              title: `Move spend from ${platformLabel(loser.account.platform)} toward ${platformLabel(winner.account.platform)}`,
              rationale: `${platformLabel(winner.account.platform)} brings a lead for $${winner.cpa!.toFixed(2)} on ${winner.campaign.name}. ${platformLabel(loser.account.platform)} costs $${loser.cpa!.toFixed(2)} on ${loser.campaign.name}. ${
                budgetShiftOn
                  ? `Approve lowers the weaker platform budget by ${M51_THRESHOLDS.shiftPercent}%.`
                  : "Budget shift is recommend-only here — Approve will not change spend."
              }${funnel.boosts && funnel.why ? ` ${funnel.why}` : ""}`,
              estimatedImpactUsd: money(opportunity),
              risk: "medium",
              confidence: confidence(funnel.boosts ? 0.8 : 0.68),
              evidence: {
                platform: loser.account.platform,
                winnerPlatform: winner.account.platform,
                inbox: "budget_shift",
                winnerCpaUsd: money(winner.cpa!),
                loserCpaUsd: money(loser.cpa!),
                spend30dUsd: money(loser.spend),
                funnel: funnel.boosts ? input.funnel : undefined,
              },
              mutations: budgetShiftMutations(budgetShiftOn, loser.account.platform, [
                {
                  entity: loser.campaign,
                  payload: {
                    percent: -M51_THRESHOLDS.shiftPercent,
                    direction: "down",
                    reason: "shift_to_winning_platform",
                    winningPlatform: winner.account.platform,
                  },
                },
              ]),
            }),
          );
        }
      }
    }
  }

  if (isCapabilityVisible("m51.grok_creatives", input.capabilities) || isCapabilityVisible("m51.brainstorm", input.capabilities)) {
    for (const account of input.accounts) {
      const ads = account.entities.filter((entity) => entity.entityType === "ad");
      const compareRows: AdCompareRow[] = ads.map((ad) => {
        const m30 = metricFor(account.metrics, ad.externalId, "30d") ?? metricFor(account.metrics, ad.externalId, "7d");
        return {
          externalId: ad.externalId,
          name: ad.name,
          platform: account.platform,
          impressions: m30?.impressions ?? 0,
          clicks: m30?.clicks ?? 0,
          conversions: m30 ? num(m30.conversions) : 0,
          spendUsd: m30 ? num(m30.spendUsd) : 0,
        };
      });
      const lift = compareAdsInGroup(compareRows);
      const winnerAd = lift
        ? ads.find((ad) => ad.externalId === lift.winnerId)
        : ads[0];
      const targetPlatform = otherPlatform(account.platform);
      const targetAccount = input.accounts.find((row) => row.platform === targetPlatform);
      if (!winnerAd || !targetAccount) continue;
      const winnerCreative = creativeFromRaw(winnerAd.raw);
      const sentiment = analyzeCopySentiment(winnerCreative);
      const parentCampaign =
        account.entities.find((entity) => entity.entityType === "campaign" && childAds(account, entity.externalId).some((ad) => ad.externalId === winnerAd.externalId)) ??
        account.entities.find((entity) => entity.entityType === "campaign");
      const destCampaign = targetAccount.entities.find((entity) => entity.entityType === "campaign");
      if (!destCampaign || !parentCampaign) continue;
      const winnerRow = compareRows.find((row) => row.externalId === winnerAd.externalId);
      const funnel = funnelStrengthFor(input.funnel, account.platform, parentCampaign.name);
      findings.push(
        finding(input, "creative_cross_platform", "low", `${winnerAd.name} is winning on ${platformLabel(account.platform)}`, {
          platform: account.platform,
          adExternalId: winnerAd.externalId,
          lift: lift ?? null,
          sentiment,
        }),
      );
      recommendations.push(
        recommendation(input, targetAccount.adAccountId, {
          type: "creative_test",
          ruleId: "creative_cross_platform",
          title: `Test the winning ${platformLabel(account.platform)} ad on ${platformLabel(targetPlatform)}`,
          rationale: `${winnerAd.name} is the stronger creative on ${platformLabel(account.platform)}${
            lift ? ` — ${lift.why}` : winnerRow ? ` (${winnerRow.clicks} clicks from ${winnerRow.impressions} views)` : ""
          }. Approve creates a ${platformLabel(targetPlatform)} test from that idea. Grok can adapt it first. Generate never writes live.${funnel.boosts && funnel.why ? ` ${funnel.why}` : ""}`,
          estimatedImpactUsd: winnerRow && winnerRow.spendUsd > 0 ? money(winnerRow.spendUsd * 0.08) : null,
          risk: "low",
          confidence: confidence(funnel.boosts ? 0.7 : 0.58),
          evidence: {
            platform: targetPlatform,
            sourcePlatform: account.platform,
            inbox: "creative_test",
            sourceAdExternalId: winnerAd.externalId,
            sourceHeadline: winnerCreative.headline,
            sentiment,
            lift: lift ?? null,
            funnel: funnel.boosts ? input.funnel : undefined,
          },
          mutations: [
            mutation(targetPlatform, "create_ad", destCampaign, {
              proposedName: `${winnerAd.name} — ${platformLabel(targetPlatform)} test`,
              sourcePlatform: account.platform,
              sourceAdExternalId: winnerAd.externalId,
              headline: winnerCreative.headline,
              body: winnerCreative.body,
            }),
          ],
        }),
      );
    }
  }

  if (isCapabilityVisible("m51.lp_congruence", input.capabilities)) {
    for (const account of input.accounts) {
      for (const ad of account.entities.filter((entity) => entity.entityType === "ad")) {
        const creative = creativeFromRaw(ad.raw);
        const page = landingFromCreative(creative, ad.raw);
        if (!page) continue;
        const mismatch = compareAdToLanding(creative, page);
        if (mismatch.matched) continue;
        findings.push(
          finding(input, "lp_mismatch", "medium", `${ad.name} does not match its landing page`, {
            platform: account.platform,
            adAccountId: account.adAccountId,
            url: page.url,
            score: mismatch.score,
          }),
        );
        recommendations.push(
          recommendation(input, account.adAccountId, {
            type: "lp_congruence",
            ruleId: "lp_mismatch",
            title: `Fix the page so it matches ${ad.name}`,
            rationale: `${mismatch.why} Cerevex cannot change the website in this slice — Site apply later.`,
            estimatedImpactUsd: null,
            risk: "low",
            confidence: confidence(0.61),
            evidence: {
              platform: account.platform,
              inbox: "lp_congruence",
              adExternalId: ad.externalId,
              landingPageUrl: page.url,
              siteApply: "later",
              recommendedFixes: mismatch.recommendedFixes,
              score: mismatch.score,
            },
            mutations: [
              mutation(account.platform, "review", ad, {
                action: "lp_congruence",
                siteApply: "later",
                recommendedFixes: mismatch.recommendedFixes,
              }),
            ],
          }),
        );
      }
    }
  }

  return { findings, recommendations };
}

export function toM51AccountSlice(input: EvaluateAccountInput & { rawByExternalId?: Record<string, Record<string, unknown>> }): M51AccountSlice {
  return {
    adAccountId: input.adAccountId,
    platform: input.platform,
    entities: input.entities.map((entity) => ({
      ...entity,
      raw: input.rawByExternalId?.[entity.externalId],
    })),
    metrics: input.metrics,
  };
}
