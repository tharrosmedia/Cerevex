/**
 * Slice 1 native jobs. They read the pinned skill and the seeded layer,
 * then write recommendation records. Missing sources become needs_data.
 * They do not invent platform numbers or call a model.
 */

import { createHash } from "node:crypto";
import { SkillGateError, assertSkillRunAllowed } from "./gates";
import { canonicalDedupeKey, ingestRecommendationRecords, type IngestResult } from "./ingest";
import { deterministicSpend, resolveSkillPrompt, type AiSpendLog, type ResolvedPrompt } from "./resolved-prompt";
import type { ClientSkillConfig } from "./types";

export interface SkillJobRun {
  job: "paid-media" | "seo-audit" | "seo-research";
  platform: "meta" | "google" | null;
  resolved: ResolvedPrompt;
  spend: AiSpendLog;
  ingest: IngestResult;
  notChecked: string[];
}

export function runPaidMediaJob(
  client: ClientSkillConfig,
  platform: "meta" | "google",
  options: { now?: Date; runId?: string } = {},
): SkillJobRun {
  assertPilot(client);
  const now = options.now ?? new Date();
  const resolved = resolveSkillPrompt(client, "paid-media");
  const store = client.stores[0];
  const records: unknown[] = [];
  const notChecked = ["LSA", "Microsoft Ads", "TikTok", "OpenAI Ads", "offline conversion import"];
  const tracking = store?.measurement.conversionTrackingAudit.value;
  if (tracking !== "pass" && tracking !== "pass_with_gaps") {
    records.push(
      record(client, resolved, now, 1, {
        channel: platform === "google" ? "google_search" : "meta",
        target: "gate:conversion-tracking-audit",
        finding: "Conversion tracking has not been audited, so bid and budget changes wait.",
        why: "Tracking has not been checked, so budget changes stay in needs data.",
        requires: ["conversion-tracking-audit:pass"],
      }),
    );
  }
  const channel = store?.channels.find((row) =>
    platform === "google" ? /google ads/i.test(row.channel) : /^meta$/i.test(row.channel),
  );
  if (!channel || channel.access.state === "tbd" || /planned/i.test(channel.status.value ?? "")) {
    records.push(
      record(client, resolved, now, records.length + 1, {
        channel: platform === "google" ? "google_search" : "meta",
        target: platform === "google" ? "google_ads:account" : "meta:account",
        finding:
          platform === "google"
            ? "Google Ads is planned and access is still TBD."
            : "Meta is planned and access is still TBD.",
        why: "The ad account is not connected, so this review did not read live spend.",
      }),
    );
  }
  if (platform === "google") {
    records.push(
      record(client, resolved, now, records.length + 1, {
        channel: "merchant_center",
        target: "merchant_center:feed",
        finding: "Merchant Center and MAP documents are not available, so feed checks were not run.",
        why: "Shopping and price checks wait until the feed and the MAP documents are on file.",
      }),
    );
    notChecked.push("Merchant Center feed");
  }
  records.push(
    record(client, resolved, now, records.length + 1, {
      channel: platform === "google" ? "google_search" : "meta",
      target: platform === "google" ? "google_ads:search-terms" : "meta:search-terms",
      finding: "No search-terms report was supplied, so no negatives are proposed.",
      why: "Without a search-terms report, this run does not invent negatives.",
    }),
  );
  return finish(client, "paid-media", platform, resolved, records, notChecked, now, options.runId);
}

export function runSeoAuditJob(
  client: ClientSkillConfig,
  options: { now?: Date; runId?: string; gscRowCount?: number } = {},
): SkillJobRun {
  assertPilot(client);
  const now = options.now ?? new Date();
  const resolved = resolveSkillPrompt(client, "seo-audit");
  const rows = options.gscRowCount ?? 0;
  const finding =
    rows > 0
      ? `Search Console has ${rows} rows. Page fetches were not run, so on-page issues were not scored.`
      : "Search Console rows were not available, so this SEO audit was not checked.";
  const records = [
    record(client, resolved, now, 1, {
      channel: "seo",
      target: client.stores[0]?.site?.value ?? "site:unknown",
      finding,
      why: "This audit only reports what it could read. It does not guess at rankings.",
      skill: "seo-audit",
    }),
  ];
  return finish(client, "seo-audit", null, resolved, records, ["GBP", "Merchant Center", "geo-grid", "page fetch"], now, options.runId);
}

export function runSeoResearchJob(
  client: ClientSkillConfig,
  options: { now?: Date; runId?: string; keyword?: string } = {},
): SkillJobRun {
  assertPilot(client);
  const now = options.now ?? new Date();
  const resolved = resolveSkillPrompt(client, "seo-research");
  const keyword = options.keyword?.trim() ?? "";
  const finding = keyword
    ? `No SERP source is connected, so "${keyword}" does not have a content brief yet.`
    : "SEO research needs a primary keyword before it can write a brief.";
  const records = [
    record(client, resolved, now, 1, {
      channel: "seo",
      target: keyword ? `query:${keyword}` : "query:missing",
      finding,
      why: keyword
        ? "The brief waits until a SERP source is connected. No ranking scores were invented."
        : "A primary keyword is required. This run did not pick one.",
      skill: "seo-research",
    }),
  ];
  return finish(client, "seo-research", null, resolved, records, ["SERP provider", "top-5 page scores"], now, options.runId);
}

function finish(
  client: ClientSkillConfig,
  job: SkillJobRun["job"],
  platform: SkillJobRun["platform"],
  resolved: ResolvedPrompt,
  records: unknown[],
  notChecked: string[],
  now: Date,
  runId: string | undefined,
): SkillJobRun {
  const id = runId ?? createHash("sha256").update(`${job}:${platform ?? ""}:${now.toISOString()}`).digest("hex").slice(0, 16);
  return {
    job,
    platform,
    resolved,
    spend: deterministicSpend(client.slug, platform ? `${job}:${platform}` : job, resolved, id),
    ingest: ingestRecommendationRecords(records, { clientSlug: client.slug, now }),
    notChecked,
  };
}

function assertPilot(client: ClientSkillConfig): void {
  assertSkillRunAllowed({ clientSlug: client.slug, runKind: "marketing", marketingGate: client.marketingGate });
  if (!client.pilot) throw new SkillGateError({ allowed: false, gate: "scope", reason: "Slice 1 pilot is HVAC USA only" });
}

function record(
  client: ClientSkillConfig,
  resolved: ResolvedPrompt,
  now: Date,
  n: number,
  input: {
    channel: string;
    target: string;
    finding: string;
    why: string;
    requires?: string[];
    skill?: string;
  },
): Record<string, unknown> {
  const store = client.stores[0]?.storeKey ?? "all";
  const skill = input.skill ?? "paid-media";
  const job = skill === "paid-media" ? "paid-media" : skill;
  const row = {
    id: `REC-${client.slug}-${stamp(now)}-${job}-${n}`,
    format: "1.1",
    client: client.slug,
    store,
    source: `native:${job}`,
    versions: {
      skill: skill === "paid-media" ? resolved.templateVersion : templateVersion(skill, resolved),
      pack: resolved.packVersion,
      layer: resolved.layerVersion,
    },
    target: input.target,
    skill,
    channel: input.channel,
    group: "needs_data",
    finding: input.finding,
    why_plain: input.why,
    requires: input.requires ?? [],
    approval: { status: "PENDING_APPROVAL" },
  };
  return {
    ...row,
    dedupe_key: canonicalDedupeKey({ store, target: input.target, channel: input.channel, change: null }),
  };
}

function templateVersion(skill: string, resolved: ResolvedPrompt): string {
  if (skill === resolved.skill) return resolved.templateVersion;
  return `${skill}@pinned`;
}

function stamp(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}
