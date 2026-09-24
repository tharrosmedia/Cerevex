export type AdsPlatform = "meta" | "google";

const FINDING_LABELS: Record<string, string> = {
  account_snapshot: "Account snapshot",
  no_entities: "Nothing synced yet",
  no_ad_accounts: "No ad accounts",
  zero_conversion_spend: "Spend with no leads",
  high_cpa: "Leads cost more than usual",
  low_ctr: "Ads not getting clicks",
  single_ad: "Only one ad",
  thin_keywords: "Thin keyword coverage",
  spend_concentration: "Spend on one campaign",
  budget_shift_gap: "Move money to the winner",
  budget_shift_cross_platform: "Winning platform",
  creative_cross_platform: "Winning ad on one platform",
  lp_mismatch: "Ad and page do not match",
  lp_intelligence: "Landing-page session signals",
  lead_lifecycle: "Lead to booked",
  booked_job: "Booked job ads signal",
  creative_fatigue: "Creative looks tired",
  search_negatives: "Search-term waste",
  geo_discipline: "Service area too wide",
  brand_guardrails: "Claim or brand risk",
  brand_guardrail_block: "Claim or brand risk",
  brand_guardrail_warn: "Claim or brand warning",
  seasonality_active: "Seasonal offer window",
  seasonality_upcoming: "Upcoming offer window",
  owner_weekly_narrative: "Owner weekly brief",
};

const SUGGESTION_LABELS: Record<string, string> = {
  pause_waste: "Stop wasted spend",
  review_cpa: "Review costly ads",
  improve_ctr: "Refresh the ad",
  add_creative: "Add another ad",
  expand_keywords: "Cover more search terms",
  spend_concentration: "Watch spend concentration",
  budget_shift: "Shift the budget",
  creative_test: "Test this ad on the other platform",
  lp_congruence: "Match the landing page",
  create_alternative: "Create the Grok alternative",
  call_attribution: "Calls joined to a campaign",
  crm_booked_job: "Call booked a job",
  lead_lifecycle: "Lead moved toward booked",
  booked_job: "Booked jobs can steer ads",
  lp_intelligence: "Improve the landing page",
  creative_fatigue: "Refresh the tired ad",
  search_negatives: "Add Google negatives",
  geo_discipline: "Tighten the service area",
  brand_guardrails: "Hold a claim or brand risk",
  seasonality: "Plan the seasonal offer",
  weekly_narrative: "Owner weekly brief",
};

const SUGGESTION_WHY: Record<string, string> = {
  pause_waste: "This campaign spent money without bringing in leads.",
  review_cpa: "Leads from this campaign cost more than usual.",
  improve_ctr: "People are seeing the ad but not clicking it.",
  add_creative: "One ad is carrying the campaign.",
  expand_keywords: "The search terms are too thin.",
  spend_concentration: "Almost all spend sits on one campaign.",
  budget_shift: "The cheaper campaign or platform is winning. Approve moves spend there.",
  creative_test: "What is winning on one platform can be tested on the other.",
  lp_congruence: "The ad promise and the landing page do not match.",
  create_alternative: "Grok made an alternative. Approve creates the ad. Generate did not write live.",
  call_attribution: "Calls joined to a campaign in plain language.",
  crm_booked_job: "A call matches a booked job. Nothing was written to the CRM.",
  lead_lifecycle: "A lead moved on the common path inside Cerevex. CRM apply later.",
  booked_job: "A booked job can steer ads. Approve writes only when the signal flag is on.",
  lp_intelligence: "Session signals show where the landing page loses people. Site apply later.",
  creative_fatigue: "This ad has been shown enough. Approve records a refresh plan. Nothing is written live.",
  search_negatives: "Wasteful Google searches spent money with no leads. Approve adds negatives only when the flag is on.",
  geo_discipline: "Ads are aimed wider than the shop's service area. Approve tightens only when the flag is on.",
  brand_guardrails: "A claim or brand risk must block or warn. Unsupervised spend cannot pass this quietly.",
  seasonality: "A seasonal window is active or close. Approve changes live ads only when the calendar flag is on.",
  weekly_narrative: "This week's brief is grounded in synced spend and leads. Approve writes only a recommended action inside it.",
};

const AUDIT_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  stub: "Queued",
};

const SUGGESTION_STATUS_LABELS: Record<string, string> = {
  proposed: "Open",
  authorized: "Approved",
  denied: "Dismissed",
  snoozed: "Later",
};

const APPLY_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  pending: "Queued",
  applying: "Applying",
  succeeded: "Succeeded",
  failed: "Failed",
  blocked: "Blocked",
};

const RISK_LABELS: Record<string, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export function findingLabel(ruleId: string | null | undefined, fallbackTitle?: string): string {
  if (ruleId && FINDING_LABELS[ruleId]) return FINDING_LABELS[ruleId];
  return fallbackTitle?.trim() || "Finding";
}

export function suggestionLabel(type: string | null | undefined, fallbackTitle?: string): string {
  if (type && SUGGESTION_LABELS[type]) return SUGGESTION_LABELS[type];
  return fallbackTitle?.trim() || "Suggestion";
}

export function suggestionWhy(type: string | null | undefined, fallback?: string): string {
  if (type && SUGGESTION_WHY[type]) return SUGGESTION_WHY[type];
  return fallback?.trim() || "Cerevex flagged this during a check.";
}

export function auditStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return AUDIT_STATUS_LABELS[status] ?? titleCase(status);
}

export function suggestionStatusLabel(status: string | null | undefined): string {
  if (!status) return "Open";
  return SUGGESTION_STATUS_LABELS[status] ?? titleCase(status);
}

export function applyStatusLabel(status: string | null | undefined): string {
  if (!status) return "Not applied";
  return APPLY_STATUS_LABELS[status] ?? titleCase(status);
}

export function riskLabel(risk: string | null | undefined): string {
  if (!risk) return "";
  return RISK_LABELS[risk] ?? titleCase(risk);
}

export function platformLabel(platform: string | null | undefined): string {
  if (platform === "google") return "Google";
  if (platform === "meta") return "Meta";
  return platform ? titleCase(platform) : "";
}

export function formatMoney(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount);
}

export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function shortWhen(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function rankSuggestions<T extends { estimatedImpactUsd?: string | null; confidence?: string | null }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => suggestionScore(b) - suggestionScore(a));
}

export function suggestionScore(item: { estimatedImpactUsd?: string | null; confidence?: string | null }): number {
  const impact = Number(item.estimatedImpactUsd ?? 0);
  const confidence = Number(item.confidence ?? 0.5);
  const safeImpact = Number.isFinite(impact) ? impact : 0;
  const safeConfidence = Number.isFinite(confidence) ? confidence : 0.5;
  return safeImpact * safeConfidence;
}

export function ruleIdFromBody(body: Record<string, unknown> | null | undefined): string | null {
  return typeof body?.ruleId === "string" ? body.ruleId : null;
}

export function platformFromRecord(
  record: Record<string, unknown> | null | undefined,
): AdsPlatform | null {
  const value = record?.platform;
  if (value === "meta" || value === "google") return value;
  return null;
}

export function metricLines(record: Record<string, unknown> | null | undefined): string[] {
  if (!record) return [];
  const lines: string[] = [];
  if (typeof record.spend30dUsd === "string" || typeof record.spend30dUsd === "number") {
    const spend = formatMoney(record.spend30dUsd);
    if (spend) lines.push(`Spend (30 days): ${spend}`);
  }
  if (typeof record.spend7dUsd === "string" || typeof record.spend7dUsd === "number") {
    const spend = formatMoney(record.spend7dUsd);
    if (spend) lines.push(`Spend (7 days): ${spend}`);
  }
  if (typeof record.conversions === "string" || typeof record.conversions === "number") {
    lines.push(`Leads: ${record.conversions}`);
  }
  if (typeof record.cpa30dUsd === "string" || typeof record.cpa30dUsd === "number") {
    const cost = formatMoney(record.cpa30dUsd);
    if (cost) lines.push(`Cost per lead: ${cost}`);
  }
  if (typeof record.entityCount === "number") lines.push(`Items checked: ${record.entityCount}`);
  if (typeof record.campaignCount === "number") lines.push(`Campaigns: ${record.campaignCount}`);
  if (typeof record.adCount === "number") lines.push(`Ads: ${record.adCount}`);
  if (typeof record.keywordCount === "number") lines.push(`Keywords: ${record.keywordCount}`);
  if (typeof record.impressions === "number") lines.push(`Impressions: ${record.impressions}`);
  if (typeof record.clicks === "number") lines.push(`Clicks: ${record.clicks}`);
  if (typeof record.ctr === "number") lines.push(`Click rate: ${(record.ctr * 100).toFixed(2)}%`);
  if (typeof record.callCount === "number") lines.push(`Calls pulled: ${record.callCount}`);
  if (typeof record.answeredCount === "number") lines.push(`Answered: ${record.answeredCount}`);
  if (typeof record.conversionCount === "number") lines.push(`CallRail conversions: ${record.conversionCount}`);
  if (typeof record.bookedJoinCount === "number") lines.push(`Booked-job joins: ${record.bookedJoinCount}`);
  if (typeof record.leadCount === "number") lines.push(`New leads: ${record.leadCount}`);
  if (typeof record.contactedCount === "number") lines.push(`Contacted: ${record.contactedCount}`);
  if (typeof record.bookedCount === "number") lines.push(`Booked: ${record.bookedCount}`);
  if (typeof record.bookedJobCount === "number") lines.push(`Booked jobs: ${record.bookedJobCount}`);
  if (typeof record.campaignName === "string") lines.push(`Campaign: ${record.campaignName}`);
  if (record.crmWrite === "later") lines.push("CRM apply later — Cerevex does not write Housecall Pro in this slice.");
  if (typeof record.hint === "string") lines.push(record.hint);
  if (typeof record.entityExternalId === "string") lines.push(`Entity: ${record.entityExternalId}`);
  if (typeof record.adAccountId === "string") lines.push(`Account: ${record.adAccountId}`);
  if (typeof record.auditRunId === "string") lines.push(`Audit: ${record.auditRunId}`);
  if (typeof record.winnerCpaUsd === "string" || typeof record.winnerCpaUsd === "number") {
    const cost = formatMoney(record.winnerCpaUsd);
    if (cost) lines.push(`Winning cost per lead: ${cost}`);
  }
  if (typeof record.loserCpaUsd === "string" || typeof record.loserCpaUsd === "number") {
    const cost = formatMoney(record.loserCpaUsd);
    if (cost) lines.push(`Weaker cost per lead: ${cost}`);
  }
  if (typeof record.sourcePlatform === "string") lines.push(`Winning platform: ${titleCase(record.sourcePlatform)}`);
  if (typeof record.landingPageUrl === "string") lines.push(`Page: ${record.landingPageUrl}`);
  if (typeof record.kind === "string") lines.push(`Change: ${titleCase(record.kind)}`);
  if (typeof record.metric === "string") lines.push(`Signal: ${record.metric}`);
  if (typeof record.value === "number") lines.push(`Signal value: ${record.value}`);
  if (typeof record.sessionCount === "number") lines.push(`Sessions in summary: ${record.sessionCount}`);
  if (record.siteApply === "later") lines.push("Site apply later — Cerevex cannot change the website in this slice.");
  if (record.capture === false) lines.push("No in-house session recorder. Signals come from Clarity.");
  if (typeof record.impressions30d === "number") lines.push(`Impressions (30 days): ${record.impressions30d}`);
  if (typeof record.impressions7d === "number") lines.push(`Impressions (7 days): ${record.impressions7d}`);
  if (typeof record.ctr30d === "number") lines.push(`Click rate (30 days): ${(record.ctr30d * 100).toFixed(2)}%`);
  if (typeof record.ctr7d === "number") lines.push(`Click rate (7 days): ${(record.ctr7d * 100).toFixed(2)}%`);
  if (typeof record.cadenceDays === "number") lines.push(`Refresh cadence: about every ${record.cadenceDays} days`);
  if (typeof record.searchTermCount === "number") lines.push(`Wasteful search terms: ${record.searchTermCount}`);
  if (Array.isArray(record.searchTerms)) {
    for (const term of record.searchTerms) {
      if (term && typeof term === "object" && typeof (term as { text?: unknown }).text === "string") {
        const row = term as { text: string; spendUsd?: number };
        const spend = formatMoney(row.spendUsd ?? null);
        lines.push(spend ? `Search: ${row.text} (${spend})` : `Search: ${row.text}`);
      }
    }
  }
  if (Array.isArray(record.targeting) && record.targeting.every((row) => typeof row === "string")) {
    lines.push(`Targeting: ${(record.targeting as string[]).join(", ")}`);
  }
  if (Array.isArray(record.serviceArea) && record.serviceArea.every((row) => typeof row === "string")) {
    lines.push(`Service area: ${(record.serviceArea as string[]).join(", ")}`);
  }
  if (typeof record.radiusMiles === "number") lines.push(`Radius: ${record.radiusMiles} miles`);
  if (typeof record.windowName === "string") lines.push(`Calendar window: ${record.windowName}`);
  if (typeof record.windowWhen === "string") lines.push(`Dates: ${record.windowWhen}`);
  if (typeof record.intent === "string") lines.push(`Plan: ${titleCase(record.intent)}`);
  if (typeof record.phase === "string") lines.push(`Timing: ${record.phase === "active" ? "Now" : "Upcoming"}`);
  if (typeof record.offerCopy === "string") lines.push(`Offer: ${record.offerCopy}`);
  if (typeof record.weekOf === "string") lines.push(`Week of: ${record.weekOf}`);
  if (typeof record.leads7d === "number") lines.push(`Leads (7 days): ${record.leads7d}`);
  if (typeof record.leads30d === "number") lines.push(`Leads (30 days): ${record.leads30d}`);
  if (typeof record.wasteSpend7dUsd === "string" || typeof record.wasteSpend7dUsd === "number") {
    const spend = formatMoney(record.wasteSpend7dUsd);
    if (spend) lines.push(`Waste this week: ${spend}`);
  }
  if (Array.isArray(record.wasteCampaigns) && record.wasteCampaigns.every((row) => typeof row === "string")) {
    if (record.wasteCampaigns.length > 0) lines.push(`Waste campaigns: ${(record.wasteCampaigns as string[]).join(", ")}`);
  }
  if (typeof record.winnerName === "string") lines.push(`Stronger campaign: ${record.winnerName}`);
  if (typeof record.loserName === "string") lines.push(`Weaker campaign: ${record.loserName}`);
  if (typeof record.callsAnswered === "number") lines.push(`Answered calls: ${record.callsAnswered}`);
  if (typeof record.bookedJobs === "number") lines.push(`Booked jobs: ${record.bookedJobs}`);
  if (typeof record.newLeads === "number") lines.push(`CRM leads: ${record.newLeads}`);
  if (Array.isArray(record.paragraphs) && record.paragraphs.every((row) => typeof row === "string")) {
    for (const line of record.paragraphs as string[]) lines.push(line);
  }
  if (typeof record.guardrail === "string") lines.push(`Guardrail: ${record.guardrail === "block" ? "Block" : "Warn"}`);
  if (Array.isArray(record.claimHits)) {
    const terms = record.claimHits
      .map((hit) => (hit && typeof hit === "object" && typeof (hit as { term?: unknown }).term === "string" ? (hit as { term: string }).term : null))
      .filter((term): term is string => Boolean(term));
    if (terms.length > 0) lines.push(`Claim hits: ${terms.join(", ")}`);
  }
  return lines;
}

export const REC_INBOX_KINDS = [
  { value: "budget_shift", label: "Budget" },
  { value: "creative_test", label: "Creative test" },
  { value: "lp_congruence", label: "Landing page" },
  { value: "lp_intelligence", label: "LP structure" },
  { value: "lead_lifecycle", label: "Lead path" },
  { value: "booked_job", label: "Booked job" },
  { value: "create_alternative", label: "Create alternative" },
  { value: "creative_fatigue", label: "Creative fatigue" },
  { value: "search_negatives", label: "Search terms" },
  { value: "geo_discipline", label: "Service area" },
  { value: "brand_guardrails", label: "Brand guardrail" },
  { value: "seasonality", label: "Seasonality" },
  { value: "weekly_narrative", label: "Weekly brief" },
] as const;

export const ADS_CONNECT_PENDING = 'Connecting…';
export const ADS_CONNECT_NO_CLIENT = 'Choose a client first, then connect.';
export const ADS_SYNC_PENDING = 'Syncing…';
export const ADS_SYNC_QUEUED = 'Sync queued. Campaigns update when the job finishes.';
export const ADS_SYNC_NO_ACCOUNT = 'Connect Meta or Google first.';
export const ADS_CHECK_PENDING = 'Checking…';
export const ADS_CHECK_NO_CLIENT = 'Choose a client to run a check.';
export const ADS_APPROVE_SOFT_LAUNCH =
  'Approve is limited to Adam during soft-launch. Deny and Snooze never write platforms.';
export const ADS_APPROVE_PAUSED = 'Ads are paused. Approve cannot apply until the pause is off.';
export const ADS_APPROVE_FROZEN = 'This ad account is frozen. Unfreeze it before Approve can apply.';

export function suggestionInboxKind(type: string | null | undefined): string {
  if (type === "budget_shift") return "Budget";
  if (type === "creative_test") return "Creative test";
  if (type === "lp_congruence") return "Landing page";
  if (type === "lp_intelligence") return "LP structure";
  if (type === "lead_lifecycle") return "Lead path";
  if (type === "booked_job") return "Booked job";
  if (type === "create_alternative") return "Create alternative";
  if (type === "creative_fatigue") return "Creative fatigue";
  if (type === "search_negatives") return "Search terms";
  if (type === "geo_discipline") return "Service area";
  if (type === "brand_guardrails") return "Brand guardrail";
  if (type === "seasonality") return "Seasonality";
  if (type === "weekly_narrative") return "Weekly brief";
  return "Check";
}
