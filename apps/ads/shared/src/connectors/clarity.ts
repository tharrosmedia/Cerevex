/**
 * Microsoft Clarity Connect (M5.2 Phase C).
 * Aggregated heatmap / session signals only. No in-house recorder. No raw PII dump.
 */

import { readProcessEnv } from "@cerevex/contracts";
import { mockClaritySignals, type AggregatedSessionSignal } from "../lp-intelligence";
import type {
  AnalyticsConnector,
  ConnectorConnectInput,
  ConnectorConnectResult,
  SessionSignalsPullInput,
  SessionSignalsPullResult,
} from "./types";

const CLARITY_INSIGHTS = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export function clarityEnvCredentials(
  env = readProcessEnv(),
): { apiKey: string; projectId: string } | null {
  const apiKey = (env.CLARITY_API_KEY ?? env.CLARITY_API_TOKEN ?? "").trim();
  const projectId = (env.CLARITY_PROJECT_ID ?? "").trim();
  if (!apiKey) return null;
  return { apiKey, projectId };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(asString(value).replace(/%/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function insightRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.metrics)) return record.metrics as Record<string, unknown>[];
    if (Array.isArray(record.data)) return record.data as Record<string, unknown>[];
  }
  return [];
}

/**
 * Map Clarity live-insights aggregates to hero / structure / copy / wizard signals.
 * Never returns session recordings, click maps, or visitor identifiers.
 */
export function signalsFromClarityInsights(
  body: unknown,
  clientName: string,
): { signals: AggregatedSessionSignal[]; sessionCount: number } {
  const rows = insightRows(body);
  let sessionCount = 0;
  let pagesPerSession = 0;
  let activeTime = 0;
  let topUrl = "";
  let topTitle = "";

  for (const row of rows) {
    const metric = asString(row.metricName || row.metric || row.name).toLowerCase();
    const info = Array.isArray(row.information) ? row.information : Array.isArray(row.data) ? row.data : [row];
    for (const item of info) {
      const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      sessionCount = Math.max(
        sessionCount,
        asNumber(rec.totalSessionCount ?? rec.sessionCount ?? rec.sessions),
      );
      const pps = asNumber(rec.PagesPerSessionPercentage ?? rec.pagesPerSession ?? rec.PagesPerSession);
      if (pps > 0) pagesPerSession = Math.max(pagesPerSession, pps > 10 ? pps / 100 : pps);
      const time = asNumber(rec.activeTime ?? rec.totalTime ?? rec.ActiveTime);
      if (time > 0) activeTime = Math.max(activeTime, time);
      const url = asString(rec.url ?? rec.URL ?? rec.pageUrl);
      if (url && !topUrl) topUrl = url;
      const title = asString(rec.documentTitle ?? rec.title);
      if (title && !topTitle) topTitle = title;
    }
    if (metric.includes("popular") || metric.includes("url")) {
      const first = info[0] && typeof info[0] === "object" ? (info[0] as Record<string, unknown>) : {};
      topUrl = asString(first.url ?? first.URL) || topUrl;
      topTitle = asString(first.documentTitle ?? first.title) || topTitle;
    }
  }

  const pageUrl = topUrl || undefined;
  const pageLabel = topTitle || `${clientName.trim() || "this shop"} landing page`;
  const signals: AggregatedSessionSignal[] = [];

  if (sessionCount > 0 && (pagesPerSession > 0 && pagesPerSession < 1.4)) {
    signals.push({
      kind: "structure",
      metric: "pages_per_session",
      value: pagesPerSession,
      pageUrl,
      pageLabel,
      why: `Sessions view about ${pagesPerSession.toFixed(1)} pages. People are not reaching a second step — move the form closer to the top.`,
      details: { pagesPerSession, sessionCount },
    });
  }
  if (sessionCount > 0 && activeTime > 0 && activeTime < 20) {
    signals.push({
      kind: "hero",
      metric: "active_time_seconds",
      value: activeTime,
      pageUrl,
      pageLabel,
      why: `Active time is about ${Math.round(activeTime)} seconds. The hero is not holding people long enough to start.`,
      details: { activeTimeSeconds: activeTime, sessionCount },
    });
  }
  if (sessionCount > 0 && topTitle) {
    signals.push({
      kind: "copy",
      metric: "engaged_page",
      value: sessionCount,
      pageUrl,
      pageLabel,
      why: `Most sessions land on “${topTitle}.” Make the offer line on that page say the next step in plain words.`,
      details: { sessionCount, documentTitle: topTitle },
    });
  }
  if (sessionCount > 0 && /quote|wizard|form|estimate/i.test(`${topUrl} ${topTitle}`)) {
    signals.push({
      kind: "wizard",
      metric: "wizard_page_sessions",
      value: sessionCount,
      pageUrl,
      pageLabel,
      why: "A large share of sessions sit on the quote flow. Shorten the first two steps so people can finish.",
      details: { sessionCount },
    });
  }

  return { signals, sessionCount };
}

export class ClarityAnalyticsConnector implements AnalyticsConnector {
  readonly kind = "analytics" as const;
  readonly implementation = "live" as const;
  readonly id = "clarity" as const;
  readonly label = "Microsoft Clarity";
  readonly connectCapability = "m52.clarity_connect" as const;
  readonly capture = false as const;

  isConfigured(): boolean {
    return clarityEnvCredentials() != null;
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (input.mock) {
      return {
        ok: true,
        stub: false,
        mock: true,
        connectorId: this.id,
        externalId: input.projectId || input.externalId || "mock-clarity",
        capture: false,
        reason: "Mock Clarity connected. Aggregated session signals only — no in-house recorder.",
      };
    }
    const env = clarityEnvCredentials();
    const apiKey = input.apiKey || (input.useEnv ? env?.apiKey : undefined);
    const projectId = input.projectId || input.externalId || (input.useEnv ? env?.projectId : undefined);
    if (!apiKey) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        capture: false,
        reason: "Clarity needs an API token and project id, or use mock connect.",
      };
    }
    const checked = await this.verifyToken(apiKey);
    if (!checked.ok) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        capture: false,
        reason: checked.reason,
      };
    }
    return {
      ok: true,
      stub: false,
      mock: false,
      connectorId: this.id,
      externalId: projectId || "clarity",
      capture: false,
      reason: "Clarity connected. Cerevex pulls aggregated session signals only. Nothing is written to Clarity.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      capture: false,
      reason: "Clarity disconnected. Stored token was removed. No Clarity write.",
    };
  }

  async pullSessionSignals(input: SessionSignalsPullInput): Promise<SessionSignalsPullResult> {
    if (input.mock) {
      const signals = mockClaritySignals(input.clientName);
      return {
        ok: true,
        mock: true,
        connectorId: this.id,
        signals,
        sessionCount: 420,
        writes: false,
        capture: false,
        reason: "Mock Clarity signals. Safe for QA without a live Clarity project.",
      };
    }
    const env = clarityEnvCredentials();
    const apiKey = input.apiKey || env?.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        mock: false,
        connectorId: this.id,
        signals: [],
        sessionCount: 0,
        writes: false,
        capture: false,
        reason: "Clarity is not configured. Connect with an API token or use mock.",
      };
    }
    try {
      const url = new URL(CLARITY_INSIGHTS);
      url.searchParams.set("numOfDays", "3");
      url.searchParams.set("dimension1", "URL");
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          mock: false,
          connectorId: this.id,
          signals: [],
          sessionCount: 0,
          writes: false,
          capture: false,
          reason: `Clarity insights failed (${res.status}). Nothing was written.`,
        };
      }
      const body = await res.json();
      const mapped = signalsFromClarityInsights(body, input.clientName);
      return {
        ok: true,
        mock: false,
        connectorId: this.id,
        signals: mapped.signals,
        sessionCount: mapped.sessionCount,
        writes: false,
        capture: false,
        reason: `${mapped.signals.length} aggregated Clarity signal${mapped.signals.length === 1 ? "" : "s"} pulled. No recordings or PII.`,
      };
    } catch (error) {
      return {
        ok: false,
        mock: false,
        connectorId: this.id,
        signals: [],
        sessionCount: 0,
        writes: false,
        capture: false,
        reason: error instanceof Error ? error.message : "Clarity pull failed.",
      };
    }
  }

  private async verifyToken(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const url = new URL(CLARITY_INSIGHTS);
      url.searchParams.set("numOfDays", "1");
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true };
      return { ok: false, reason: `Clarity project check failed (${res.status}).` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Clarity project check failed." };
    }
  }
}

export const clarityAnalyticsConnector = new ClarityAnalyticsConnector();
