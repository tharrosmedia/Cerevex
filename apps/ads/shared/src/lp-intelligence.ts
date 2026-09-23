/**
 * M5.2 Phase C — LP intelligence from aggregated Clarity session signals.
 * Recs stay recommend-only unless a Site connector can mutate the page.
 * No in-house heatmap / session recorder.
 */

import type { SiteConnector } from "./connectors/types";

export const LP_INTELLIGENCE_KINDS = ["hero", "structure", "copy", "wizard"] as const;
export type LpIntelligenceKind = (typeof LP_INTELLIGENCE_KINDS)[number];

export type AggregatedSessionSignal = {
  kind: LpIntelligenceKind;
  metric: string;
  value: number;
  pageUrl?: string;
  pageLabel?: string;
  why: string;
  details: Record<string, number | string>;
};

export type SessionSignalsSnapshot = {
  pulledAt: string;
  mock: boolean;
  projectId: string | null;
  sessionCount: number;
  signals: AggregatedSessionSignal[];
  capture: false;
  writes: false;
};

export type LpIntelligenceRecDraft = {
  kind: LpIntelligenceKind;
  title: string;
  rationale: string;
  why: string;
  siteApply: "later" | "ready";
  signal: AggregatedSessionSignal;
};

const KIND_TITLES: Record<LpIntelligenceKind, string> = {
  hero: "Fix the hero so the offer is obvious",
  structure: "Move the form closer to the top",
  copy: "Rewrite the unclear offer copy",
  wizard: "Simplify the quote wizard",
};

export function isLpIntelligenceKind(value: unknown): value is LpIntelligenceKind {
  return typeof value === "string" && (LP_INTELLIGENCE_KINDS as readonly string[]).includes(value);
}

export function mockClaritySignals(clientName: string, pageUrl?: string): AggregatedSessionSignal[] {
  const page = pageUrl || "https://example.test/quote";
  const label = clientName.trim() || "this shop";
  return [
    {
      kind: "hero",
      metric: "hero_dead_click_rate",
      value: 0.18,
      pageUrl: page,
      pageLabel: `${label} landing page`,
      why: "About 1 in 5 sessions dead-click the hero button. People are trying to start and the tap is not landing.",
      details: { deadClickRate: 0.18, sessionCount: 420, heroClicks: 38 },
    },
    {
      kind: "structure",
      metric: "scroll_dropoff_before_form",
      value: 0.72,
      pageUrl: page,
      pageLabel: `${label} landing page`,
      why: "Most sessions never reach the form. It sits too far below the hero.",
      details: { neverReachedForm: 0.72, medianScrollDepth: 0.38, sessionCount: 420 },
    },
    {
      kind: "copy",
      metric: "rage_clicks_on_offer",
      value: 0.11,
      pageUrl: page,
      pageLabel: `${label} landing page`,
      why: "Sessions rage-click “Learn more.” The offer line is not clear enough to act on.",
      details: { rageClickRate: 0.11, offerClicks: 24, sessionCount: 420 },
    },
    {
      kind: "wizard",
      metric: "wizard_step_dropoff",
      value: 0.61,
      pageUrl: page,
      pageLabel: `${label} quote wizard`,
      why: "Most people leave on step 2 of the quote wizard. The choices look heavier than a first quote needs.",
      details: { step2Dropoff: 0.61, stepCount: 4, sessionCount: 186 },
    },
  ];
}

export function mockClaritySnapshot(clientName: string, pageUrl?: string): SessionSignalsSnapshot {
  return {
    pulledAt: new Date().toISOString(),
    mock: true,
    projectId: "mock-clarity",
    sessionCount: 420,
    signals: mockClaritySignals(clientName, pageUrl),
    capture: false,
    writes: false,
  };
}

export function siteLandingPageApplySupported(connector: Pick<SiteConnector, "supportsLandingPageMutation">): boolean {
  return Boolean(connector.supportsLandingPageMutation);
}

export function siteApplyMode(
  connector: Pick<SiteConnector, "supportsLandingPageMutation">,
): "later" | "ready" {
  return siteLandingPageApplySupported(connector) ? "ready" : "later";
}

export function siteApplyBlockedReason(
  connector: Pick<SiteConnector, "supportsLandingPageMutation">,
  recommendationType?: string | null,
): string | null {
  if (recommendationType !== "lp_intelligence") return null;
  if (!siteLandingPageApplySupported(connector)) return "site_apply_later";
  return null;
}

export function recsFromSessionSignals(
  signals: AggregatedSessionSignal[],
  connector: Pick<SiteConnector, "supportsLandingPageMutation">,
): LpIntelligenceRecDraft[] {
  const siteApply = siteApplyMode(connector);
  const later =
    siteApply === "later"
      ? " Cerevex cannot change the website yet — Site apply later."
      : " Approve can apply this on the site.";
  return signals.map((signal) => ({
    kind: signal.kind,
    title: KIND_TITLES[signal.kind],
    why: signal.why,
    rationale: `${signal.why}${later}`,
    siteApply,
    signal,
  }));
}

export function publicClarityView(state: {
  connected?: boolean;
  mock?: boolean;
  projectId?: string | null;
  usesEnv?: boolean;
  encryptedApiKey?: string | null;
  lastPulledAt?: string | null;
  lastError?: string | null;
  snapshot?: SessionSignalsSnapshot;
} | undefined): {
  connected: boolean;
  mock: boolean;
  projectId: string | null;
  usesEnv: boolean;
  hasApiKey: boolean;
  lastPulledAt: string | null;
  lastError: string | null;
  sessionCount: number;
  signalCount: number;
  signals: AggregatedSessionSignal[];
  capture: false;
  writes: false;
  siteApply: "later";
} {
  return {
    connected: Boolean(state?.connected),
    mock: Boolean(state?.mock),
    projectId: state?.projectId ?? null,
    usesEnv: Boolean(state?.usesEnv),
    hasApiKey: Boolean(state?.encryptedApiKey),
    lastPulledAt: state?.lastPulledAt ?? null,
    lastError: state?.lastError ?? null,
    sessionCount: state?.snapshot?.sessionCount ?? 0,
    signalCount: state?.snapshot?.signals.length ?? 0,
    signals: state?.snapshot?.signals ?? [],
    capture: false,
    writes: false,
    siteApply: "later",
  };
}
