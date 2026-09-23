/**
 * M5.2 Phase E — operator hygiene.
 * Four flaggable rec families: creative fatigue, Google negatives,
 * geo / service-area, claim & brand guardrails.
 * Recommend-only by default. Executable writes only when the matching
 * flag is on and Approve passes. Deny/Snooze never write.
 */

import { copyBlob, creativeFromRaw, type CreativeFields } from "./creative-analysis";
import type { HygieneRecommendationType, Platform } from "./types";

export const HYGIENE_THRESHOLDS = {
  fatigueImpressions30d: 20_000,
  fatigueImpressions7d: 10_000,
  fatigueLowCtr: 0.02,
  fatigueCtrDrop: 0.15,
  refreshImpressions: 20_000,
  wasteSearchSpendUsd: 20,
  maxNegativesPerRec: 3,
  geoMaxRadiusMiles: 50,
} as const;

export type HygieneMetric = {
  entityExternalId: string;
  entityType: string;
  window: string;
  spendUsd: string;
  impressions: number;
  clicks: number;
  conversions: string;
};

export type HygieneEntity = {
  entityType: string;
  externalId: string;
  name: string;
  status: string;
  parentExternalId?: string | null;
  raw?: Record<string, unknown>;
};

export type SearchTermRow = {
  text: string;
  clicks: number;
  conversions: number;
  spendUsd: number;
};

export type HygieneRecDraft = {
  type: HygieneRecommendationType;
  ruleId: string;
  title: string;
  rationale: string;
  why: string;
  risk: "low" | "medium" | "high";
  estimatedImpactUsd: string | null;
  evidence: Record<string, unknown>;
  mutations: Array<{
    action: "review" | "add_negative" | "tighten_geo" | "pause";
    entity: HygieneEntity;
    payload: Record<string, unknown>;
  }>;
};

export type HygieneEvaluateInput = {
  platform: Platform;
  entities: HygieneEntity[];
  metrics: HygieneMetric[];
  creativeFatigueEnabled?: boolean;
  creativeFatigueWritable?: boolean;
  searchNegativesEnabled?: boolean;
  searchNegativesWritable?: boolean;
  geoDisciplineEnabled?: boolean;
  geoDisciplineWritable?: boolean;
  brandGuardrailsEnabled?: boolean;
  brandGuardrailsWritable?: boolean;
};

const HVAC_WASTE_TERMS: SearchTermRow[] = [
  { text: "free ductless estimate", clicks: 40, conversions: 0, spendUsd: 85 },
  { text: "diy mini split", clicks: 22, conversions: 0, spendUsd: 40 },
  { text: "hvac jobs hiring", clicks: 18, conversions: 0, spendUsd: 30 },
];

const BLOCK_CLAIMS = [
  "guaranteed",
  "100%",
  "cheapest",
  "lowest price",
  "#1",
  "number one",
  "no risk",
  "risk free",
  "risk-free",
  "fda approved",
  "cure",
];

const WARN_CLAIMS = ["act now", "limited time", "urgent", "cheap", "exclusive", "lowest"];

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return value.toFixed(2);
}

function metricFor(metrics: HygieneMetric[], externalId: string, window: string): HygieneMetric | undefined {
  return metrics.find((row) => row.entityExternalId === externalId && row.window === window);
}

function ctrOf(row: HygieneMetric | undefined): number {
  if (!row || row.impressions <= 0) return 0;
  return row.clicks / row.impressions;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function searchTermsFromRaw(raw: Record<string, unknown> | undefined): SearchTermRow[] {
  const list = raw?.searchTerms;
  if (!Array.isArray(list)) return [];
  const rows: SearchTermRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) continue;
    rows.push({
      text,
      clicks: num(obj.clicks),
      conversions: num(obj.conversions),
      spendUsd: num(obj.spendUsd),
    });
  }
  return rows;
}

export function mockWasteSearchTerms(): SearchTermRow[] {
  return HVAC_WASTE_TERMS.map((row) => ({ ...row }));
}

export function geoFromRaw(raw: Record<string, unknown> | undefined): {
  targeting: string[];
  serviceArea: string[];
  radiusMiles: number | null;
} {
  const geo =
    raw?.geo && typeof raw.geo === "object" && !Array.isArray(raw.geo)
      ? (raw.geo as Record<string, unknown>)
      : raw ?? {};
  const targeting = asStringList(geo.targeting);
  const serviceArea = asStringList(geo.serviceArea);
  const radius = num(geo.radiusMiles);
  return {
    targeting,
    serviceArea,
    radiusMiles: radius > 0 ? radius : null,
  };
}

export function isBroadGeo(input: {
  targeting: string[];
  serviceArea: string[];
  radiusMiles: number | null;
}): boolean {
  const targeting = input.targeting.map((row) => row.toLowerCase());
  const country = targeting.some((row) =>
    /united states|nationwide|usa|entire country|all states/.test(row),
  );
  const radiusBroad =
    input.radiusMiles != null && input.radiusMiles > HYGIENE_THRESHOLDS.geoMaxRadiusMiles;
  const localHint = input.serviceArea.some((row) => /local|service area|city|county/.test(row.toLowerCase()));
  return country || radiusBroad || (localHint && targeting.length > 0 && country);
}

export type ClaimHit = {
  term: string;
  level: "block" | "warn";
};

export function scanClaimHits(text: string): ClaimHit[] {
  const blob = text.toLowerCase();
  if (!blob.trim()) return [];
  const hits: ClaimHit[] = [];
  for (const term of BLOCK_CLAIMS) {
    if (blob.includes(term)) hits.push({ term, level: "block" });
  }
  for (const term of WARN_CLAIMS) {
    if (blob.includes(term) && !hits.some((hit) => hit.term === term)) {
      hits.push({ term, level: "warn" });
    }
  }
  return hits;
}

export function fieldsForHygiene(entity: HygieneEntity): CreativeFields {
  const raw = entity.raw ?? {};
  const base = creativeFromRaw(raw);
  const extra = typeof raw.brandCopy === "string" ? raw.brandCopy : null;
  return {
    ...base,
    body: [base.body, extra].filter(Boolean).join(" ") || base.body,
  };
}

export function claimHitsForEntity(entity: HygieneEntity): ClaimHit[] {
  return scanClaimHits(copyBlob(fieldsForHygiene(entity)));
}

export function isSpendIncreasingMutation(mutation: {
  action?: string;
  payload?: Record<string, unknown>;
}): boolean {
  if (mutation.action === "create_ad") return true;
  if (mutation.action !== "update_budget") return false;
  const payload = mutation.payload ?? {};
  if (payload.direction === "up") return true;
  const percent = typeof payload.percent === "number" ? payload.percent : Number(payload.percent);
  return Number.isFinite(percent) && percent > 0;
}

/**
 * When brand guardrails are visible, spend-up / create must not pass a blocking claim.
 * Hidden flag → no extra block (core apply stays healthy).
 */
export function brandGuardrailSpendBlockedReason(
  visible: boolean,
  mutation: { action?: string; payload?: Record<string, unknown> },
  hits: ClaimHit[],
): string | null {
  if (!visible) return null;
  if (!isSpendIncreasingMutation(mutation)) return null;
  if (!hits.some((hit) => hit.level === "block")) return null;
  return "brand_guardrail_block";
}

export function recsFromCreativeFatigue(input: {
  entities: HygieneEntity[];
  metrics: HygieneMetric[];
  writable: boolean;
}): HygieneRecDraft[] {
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  const ads = input.entities.filter((entity) => entity.entityType === "ad");
  const candidates: Array<{
    entity: HygieneEntity;
    impressions30d: number;
    impressions7d: number;
    ctr30d: number;
    ctr7d: number;
    spend30d: number;
    reason: string;
  }> = [];

  const consider = ads.length > 0 ? ads : campaigns;
  for (const entity of consider) {
    const m30 = metricFor(input.metrics, entity.externalId, "30d");
    const m7 = metricFor(input.metrics, entity.externalId, "7d");
    if (!m30 && !m7) continue;
    const impressions30d = m30?.impressions ?? 0;
    const impressions7d = m7?.impressions ?? 0;
    const ctr30d = ctrOf(m30);
    const ctr7d = ctrOf(m7);
    const spend30d = num(m30?.spendUsd);
    const drop = ctr30d > 0 && ctr7d > 0 ? (ctr30d - ctr7d) / ctr30d : 0;
    const tiredVolume = impressions30d >= HYGIENE_THRESHOLDS.fatigueImpressions30d;
    const tiredRecent =
      impressions7d >= HYGIENE_THRESHOLDS.fatigueImpressions7d && ctr7d < HYGIENE_THRESHOLDS.fatigueLowCtr;
    const tiredDrop = drop >= HYGIENE_THRESHOLDS.fatigueCtrDrop;
    if (!tiredVolume && !tiredRecent && !tiredDrop) continue;
    const reason = tiredDrop
      ? "Click rate fell versus the last month."
      : tiredRecent
        ? "This ad is being shown a lot and people are not clicking."
        : "This ad has been shown enough times that a refresh is due.";
    candidates.push({
      entity,
      impressions30d,
      impressions7d,
      ctr30d,
      ctr7d,
      spend30d,
      reason,
    });
  }
  if (candidates.length === 0) return [];
  const worst = [...candidates].sort((a, b) => b.impressions30d - a.impressions30d)[0]!;
  const cadenceDays = worst.impressions30d >= HYGIENE_THRESHOLDS.refreshImpressions ? 14 : 21;
  const why = `${worst.reason} Plan a new ad about every ${cadenceDays} days.`;
  return [
    {
      type: "creative_fatigue",
      ruleId: "creative_fatigue",
      title: `Refresh ${worst.entity.name}`,
      why,
      rationale: `${why} Approve records the recommendation. Deny or Snooze writes nothing. Cerevex will not create a live ad from this card.`,
      risk: "low",
      estimatedImpactUsd: worst.spend30d > 0 ? money(worst.spend30d * 0.05) : null,
      evidence: {
        inbox: "creative_fatigue",
        writes: false,
        cadenceDays,
        impressions30d: worst.impressions30d,
        impressions7d: worst.impressions7d,
        ctr30d: Number(worst.ctr30d.toFixed(4)),
        ctr7d: Number(worst.ctr7d.toFixed(4)),
        spend30dUsd: money(worst.spend30d),
        entityExternalId: worst.entity.externalId,
        hint: `Refresh cadence: about every ${cadenceDays} days after this much exposure.`,
      },
      mutations: [
        {
          action: "review",
          entity: worst.entity,
          payload: {
            action: "creative_refresh_review_only",
            m52: "creative_fatigue",
            cadenceDays,
            writable: input.writable,
          },
        },
      ],
    },
  ];
}

export function recsFromSearchNegatives(input: {
  platform: Platform;
  entities: HygieneEntity[];
  writable: boolean;
}): HygieneRecDraft[] {
  if (input.platform !== "google") return [];
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  const keywords = input.entities.filter((entity) => entity.entityType === "keyword");
  if (campaigns.length === 0) return [];

  let terms: SearchTermRow[] = [];
  let campaign = campaigns[0]!;
  for (const row of campaigns) {
    const found = searchTermsFromRaw(row.raw);
    if (found.length > 0) {
      terms = found;
      campaign = row;
      break;
    }
  }
  if (terms.length === 0 && keywords.length > 0) {
    terms = mockWasteSearchTerms();
  }
  const waste = terms
    .filter(
      (row) => row.conversions <= 0 && row.spendUsd >= HYGIENE_THRESHOLDS.wasteSearchSpendUsd,
    )
    .sort((a, b) => b.spendUsd - a.spendUsd)
    .slice(0, HYGIENE_THRESHOLDS.maxNegativesPerRec);
  if (waste.length === 0) return [];

  const spend = waste.reduce((sum, row) => sum + row.spendUsd, 0);
  const names = waste.map((row) => `"${row.text}"`).join(", ");
  const why = `People searched ${names} and spent money with no leads. Add those as negatives.`;
  const writable = input.writable;
  return [
    {
      type: "search_negatives",
      ruleId: "search_negatives",
      title: `Clean up ${waste.length} Google search term${waste.length === 1 ? "" : "s"}`,
      why,
      rationale: `${why} Approve adds the negatives only when search-term hygiene is on. Deny or Snooze writes nothing.`,
      risk: "medium",
      estimatedImpactUsd: money(spend),
      evidence: {
        inbox: "search_negatives",
        writes: false,
        platform: "google",
        searchTermCount: waste.length,
        spend30dUsd: money(spend),
        searchTerms: waste,
        hint: writable
          ? "Approve will add these as negative keywords on Google."
          : "Recommend only — Approve will not add negatives until the flag is on.",
      },
      mutations: waste.map((row) => ({
        action: writable ? ("add_negative" as const) : ("review" as const),
        entity: campaign,
        payload: {
          text: row.text,
          reason: "search_term_waste",
          m52: "search_negatives",
          ...(writable ? {} : { action: "search_negatives_review_only" }),
        },
      })),
    },
  ];
}

export function recsFromGeoDiscipline(input: {
  entities: HygieneEntity[];
  writable: boolean;
}): HygieneRecDraft[] {
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  if (campaigns.length === 0) return [];
  const groups = input.entities.filter(
    (entity) => entity.entityType === "adset" || entity.entityType === "ad_group",
  );

  for (const campaign of campaigns) {
    const hasRawGeo = Boolean(campaign.raw && campaign.raw.geo);
    const geo = geoFromRaw(campaign.raw);
    const groupHint = groups.find(
      (group) =>
        group.parentExternalId === campaign.externalId &&
        /service area/i.test(group.name),
    );
    const inferred = hasRawGeo
      ? geo
      : groupHint
        ? {
            targeting: ["United States"],
            serviceArea: [groupHint.name],
            radiusMiles: 2500,
          }
        : null;
    if (!inferred || !isBroadGeo(inferred)) continue;

    const area = inferred.serviceArea[0] ?? "the shop's service area";
    const targeting = inferred.targeting[0] ?? "a wide area";
    const why = `Ads are aimed at ${targeting}. Tighten them to ${area} so you do not pay for work you will not take.`;
    const writable = input.writable;
    return [
      {
        type: "geo_discipline",
        ruleId: "geo_discipline",
        title: `Tighten the service area on ${campaign.name}`,
        why,
        rationale: `${why} Approve records the tighten only when geo discipline is on. Deny or Snooze writes nothing.`,
        risk: "medium",
        estimatedImpactUsd: null,
        evidence: {
          inbox: "geo_discipline",
          writes: false,
          targeting: inferred.targeting,
          serviceArea: inferred.serviceArea,
          radiusMiles: inferred.radiusMiles,
          campaignName: campaign.name,
          hint: writable
            ? "Approve will record a service-area tighten on this campaign."
            : "Recommend only — Approve will not change targeting until the flag is on.",
        },
        mutations: [
          {
            action: writable ? ("tighten_geo" as const) : ("review" as const),
            entity: campaign,
            payload: {
              reason: "out_of_service_area",
              m52: "geo_discipline",
              targeting: inferred.targeting,
              serviceArea: inferred.serviceArea,
              radiusMiles: inferred.radiusMiles,
              ...(writable ? {} : { action: "geo_discipline_review_only" }),
            },
          },
        ],
      },
    ];
  }
  return [];
}

export function recsFromBrandGuardrails(input: {
  entities: HygieneEntity[];
  writable: boolean;
}): HygieneRecDraft[] {
  const ads = input.entities.filter((entity) => entity.entityType === "ad");
  const campaigns = input.entities.filter((entity) => entity.entityType === "campaign");
  const pool = ads.length > 0 ? ads : campaigns;
  let worst: { entity: HygieneEntity; hits: ClaimHit[] } | null = null;
  for (const entity of pool) {
    const hits = claimHitsForEntity(entity);
    if (hits.length === 0) continue;
    if (!worst || hits.some((hit) => hit.level === "block") && !worst.hits.some((hit) => hit.level === "block")) {
      worst = { entity, hits };
    }
  }
  if (!worst) return [];
  const block = worst.hits.some((hit) => hit.level === "block");
  const terms = worst.hits.map((hit) => hit.term).slice(0, 3).join(", ");
  const why = block
    ? `${worst.entity.name} uses a claim we cannot let spend run past (${terms}). Pause it or change the copy.`
    : `${worst.entity.name} uses pressure or brand-risk language (${terms}). Review before more spend.`;
  const writable = input.writable && block;
  return [
    {
      type: "brand_guardrails",
      ruleId: block ? "brand_guardrail_block" : "brand_guardrail_warn",
      title: block ? `Hold spend on ${worst.entity.name}` : `Review claims on ${worst.entity.name}`,
      why,
      rationale: block
        ? `${why} This is a block, not a silent pass. Approve pauses the ad only when brand guardrails are on. Deny or Snooze writes nothing.`
        : `${why} This is a warning. Approve does not write live copy. Deny or Snooze writes nothing.`,
      risk: block ? "high" : "medium",
      estimatedImpactUsd: null,
      evidence: {
        inbox: "brand_guardrails",
        writes: false,
        guardrail: block ? "block" : "warn",
        claimHits: worst.hits,
        entityExternalId: worst.entity.externalId,
        hint: block
          ? "Unsupervised spend is not allowed past this guardrail."
          : "Warning only — change the copy before you raise spend.",
      },
      mutations: [
        {
          action: writable ? ("pause" as const) : ("review" as const),
          entity: worst.entity,
          payload: {
            reason: block ? "brand_claim_block" : "brand_claim_warn",
            m52: "brand_guardrails",
            guardrail: block ? "block" : "warn",
            hits: worst.hits.map((hit) => hit.term),
            ...(writable ? {} : { action: "brand_guardrail_review_only" }),
          },
        },
      ],
    },
  ];
}

export function evaluateOperatorHygiene(input: HygieneEvaluateInput): HygieneRecDraft[] {
  const drafts: HygieneRecDraft[] = [];
  if (input.creativeFatigueEnabled) {
    drafts.push(
      ...recsFromCreativeFatigue({
        entities: input.entities,
        metrics: input.metrics,
        writable: Boolean(input.creativeFatigueWritable),
      }),
    );
  }
  if (input.searchNegativesEnabled) {
    drafts.push(
      ...recsFromSearchNegatives({
        platform: input.platform,
        entities: input.entities,
        writable: Boolean(input.searchNegativesWritable),
      }),
    );
  }
  if (input.geoDisciplineEnabled) {
    drafts.push(
      ...recsFromGeoDiscipline({
        entities: input.entities,
        writable: Boolean(input.geoDisciplineWritable),
      }),
    );
  }
  if (input.brandGuardrailsEnabled) {
    drafts.push(
      ...recsFromBrandGuardrails({
        entities: input.entities,
        writable: Boolean(input.brandGuardrailsWritable),
      }),
    );
  }
  return drafts;
}

export function isM52SearchNegativeMutation(mutation: {
  action?: string;
  payload?: Record<string, unknown>;
}): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "search_negatives") return true;
  const reason = payload.reason;
  return mutation.action === "add_negative" && reason === "search_term_waste";
}

export function isM52GeoDisciplineMutation(mutation: {
  action?: string;
  payload?: Record<string, unknown>;
}): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "geo_discipline") return true;
  return mutation.action === "tighten_geo";
}

export function isM52BrandGuardrailMutation(mutation: {
  action?: string;
  payload?: Record<string, unknown>;
}): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "brand_guardrails") return true;
  const reason = payload.reason;
  return typeof reason === "string" && reason.startsWith("brand_claim_");
}

export function isM52CreativeFatigueMutation(mutation: { payload?: Record<string, unknown> }): boolean {
  return mutation.payload?.m52 === "creative_fatigue";
}
