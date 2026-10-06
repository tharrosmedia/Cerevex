import assert from "node:assert/strict";
import { DEDUPE_WINDOW_MS, canonicalDedupeKey, ingestRecommendationRecords, ingestRecommendationYaml } from "../src/ingest";
import { RecommendationYamlError, parseRecommendationYaml } from "../src/rec-yaml";

const valid = `
- id: REC-hvac-usa-20261006-1
  format: "1.1"
  client: hvac-usa
  store: hvac-usa/web
  source: agent:cos
  versions: {skill: "paid-media@0.4.1-accepted", pack: "ecommerce-dtc@4.1.0", layer: "none"}
  target: "google_ads:campaign:123"
  dedupe_key: "hvac-usa/web|google_ads:campaign:123|google_search|lower the daily budget"
  skill: paid-media
  channel: google_search
  group: do_now
  finding: "Search spend is above the qualified-outcome cost."
  why_plain: "The search budget is high for the orders it brings in."
  change: {from: "daily budget 40", to: "lower the daily budget"}
  rollback: "Set the daily budget back to 40."
  requires: []
  approval:
    status: PENDING_APPROVAL
    approved_by: null
    executed_by: null
`;

const parsed = parseRecommendationYaml(valid);
assert.ok(Array.isArray(parsed));
assert.equal((parsed as Array<Record<string, unknown>>)[0]?.source, "agent:cos");
assert.equal(
  ((parsed as Array<Record<string, unknown>>)[0]?.approval as { status: string }).status,
  "PENDING_APPROVAL",
);

const ingested = ingestRecommendationYaml(valid, { clientSlug: "hvac-usa", now: new Date("2026-10-06T12:00:00Z") });
assert.equal(ingested.rejected.length, 0);
assert.equal(ingested.accepted.length, 1);
const first = ingested.accepted[0]!;
assert.equal(first.mergeIntoId, null);
assert.equal(first.prepared.evidence.group, "do_now");
assert.equal(first.prepared.evidence.source, "agent:cos");
assert.equal(first.prepared.evidence.versions.skill, "paid-media@0.4.1-accepted");
assert.equal(first.prepared.evidence.versions.pack, "ecommerce-dtc@4.1.0");
assert.equal(first.prepared.evidence.approveHidden, false);
assert.equal(first.prepared.scope, "store");
assert.equal(first.prepared.storeId, "hvac-usa/web");
assert.equal(first.prepared.record.approval.status, "PENDING_APPROVAL");
assert.equal(first.prepared.record.approval.executed_by, null);

const mixed = ingestRecommendationYaml(
  `${valid}
- id: REC-hvac-usa-20261006-2
  format: "1.1"
  client: hvac-usa
  source: agent:cos
  skill: paid-media
  channel: google_search
  group: do_now
  approval:
    status: PENDING_APPROVAL
`,
  { clientSlug: "hvac-usa" },
);
assert.equal(mixed.accepted.length, 1);
assert.equal(mixed.rejected.length, 1);
assert.equal(mixed.rejected[0]?.id, "REC-hvac-usa-20261006-2");
assert.ok(mixed.rejected[0]?.reasons.some((reason) => reason.includes("finding")));

const broken = ingestRecommendationYaml("-\n  id: [", { clientSlug: "hvac-usa" });
assert.equal(broken.accepted.length, 0);
assert.equal(broken.rejected.length, 1);
assert.ok(broken.rejected[0]?.reasons[0]?.includes("line"));

assert.throws(() => parseRecommendationYaml("value: |\n  hello"), RecommendationYamlError);

const approved = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-20261006-3",
      format: "1.1",
      client: "hvac-usa",
      store: "all",
      source: "agent:cos",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "unknown", layer: "none" },
      target: "layer:hvac-usa",
      dedupe_key: "all|layer:hvac-usa|all|",
      skill: "paid-media",
      channel: "all",
      group: "do_now",
      finding: "A person already approved this.",
      approval: { status: "approved", approved_by: "a skill" },
    },
  ],
  { clientSlug: "hvac-usa" },
);
assert.equal(approved.accepted.length, 0);
assert.match(approved.rejected[0]?.reasons.join(" ") ?? "", /cannot set approval.status/);

const cage = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-20261006-4",
      format: "1.1",
      client: "hvac-usa",
      store: "all",
      source: "agent:cos",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "ecommerce-dtc@4.1.0", layer: "none" },
      target: "site:home",
      dedupe_key: "all|site:home|site|add a cage line",
      skill: "paid-media",
      channel: "site",
      group: "do_now",
      finding: "The footer should name the contractor id.",
      why_plain: "Add the Cage number to the footer.",
      change: { from: "no cage line", to: "add a cage line" },
      rollback: "Remove the line.",
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  { clientSlug: "hvac-usa" },
);
assert.equal(cage.accepted.length, 1);
assert.equal(cage.accepted[0]?.prepared.evidence.group, "needs_data");
assert.equal(cage.accepted[0]?.prepared.evidence.approveHidden, true);
assert.match(cage.accepted[0]?.prepared.evidence.claimsCheck ?? "", /Cage/);

const slop = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-20261006-5",
      format: "1.1",
      client: "hvac-usa",
      store: "all",
      source: "native:paid-media",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "unknown", layer: "none" },
      target: "note:1",
      dedupe_key: "all|note:1|all|",
      skill: "paid-media",
      channel: "all",
      group: "test",
      finding: "Copy needs a pass.",
      why_plain: "We leverage a seamless tapestry. It is a game changer. Then a third sentence.",
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  { clientSlug: "hvac-usa" },
);
assert.equal(slop.accepted[0]?.prepared.evidence.group, "needs_data");
assert.match(slop.accepted[0]?.prepared.evidence.noSlop ?? "", /no-slop|two sentences/);

const spend = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-20261006-6",
      format: "1.1",
      client: "hvac-usa",
      store: "all",
      source: "native:paid-media",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "unknown", layer: "none" },
      target: "google_ads:campaign:9",
      dedupe_key: "all|google_ads:campaign:9|google_search|increase the budget",
      skill: "paid-media",
      channel: "google_search",
      group: "do_now",
      finding: "Budget can move up.",
      why_plain: "Raise search budget if the phone team has room.",
      change: { from: "budget 10", to: "increase the budget" },
      rollback: "Put the budget back.",
      requires: ["conversion-tracking-audit:pass"],
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  { clientSlug: "hvac-usa" },
);
assert.equal(spend.accepted[0]?.prepared.evidence.approveHidden, true);
assert.match(spend.accepted[0]?.prepared.evidence.approveHiddenReason ?? "", /capacity_check|conversion-tracking-audit/);

const other = ingestRecommendationRecords(
  [
    {
      id: "REC-got-1",
      format: "1.1",
      client: "got-ductless",
      store: "all",
      source: "agent:cos",
      versions: { skill: "seo-audit@0.4.1-accepted", pack: "unknown", layer: "none" },
      target: "site:home",
      dedupe_key: "all|site:home|seo|",
      skill: "seo-audit",
      channel: "seo",
      group: "do_now",
      finding: "Not the pilot.",
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  { clientSlug: "got-ductless" },
);
assert.equal(other.accepted.length, 0);
assert.match(other.rejected[0]?.reasons.join(" ") ?? "", /HVAC USA only/);

const legacy = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-legacy",
      client: "hvac-usa",
      skill: "paid-media",
      channel: "google_search",
      group: "needs_data",
      finding: "A 1.0 record still ingests.",
      approval: { status: "PENDING_APPROVAL", executed_by: "human" },
    },
  ],
  { clientSlug: "hvac-usa" },
);
assert.equal(legacy.accepted.length, 1);
assert.equal(legacy.accepted[0]?.prepared.evidence.source, "agent:unknown");
assert.equal(legacy.accepted[0]?.prepared.evidence.approveHidden, true);
assert.equal(legacy.accepted[0]?.prepared.record.approval.executed_by, null);

const native = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-native",
      format: "1.1",
      client: "hvac-usa",
      store: "hvac-usa/web",
      source: "native:paid-media",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "ecommerce-dtc@4.1.0", layer: "none" },
      target: "google_ads:campaign:123",
      dedupe_key: "hvac-usa/web|google_ads:campaign:123|google_search|lower the daily budget",
      skill: "paid-media",
      channel: "google_search",
      group: "do_now",
      finding: "Platform spend is 80.",
      why_plain: "Search is spending more than the orders support.",
      change: { from: "daily budget 40", to: "lower the daily budget" },
      rollback: "Set the daily budget back to 40.",
      baseline: 80,
      expected_monthly_dollars: { low: 400, high: 600, basis: "platform" },
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  {
    clientSlug: "hvac-usa",
    now: new Date("2026-10-06T18:00:00Z"),
    existing: [
      {
        id: "existing-1",
        createdAt: "2026-10-05T18:00:00Z",
        status: "proposed",
        prepared: first.prepared,
      },
    ],
  },
);
assert.equal(native.accepted.length, 1);
assert.equal(native.accepted[0]?.mergeIntoId, "existing-1");
assert.deepEqual(native.accepted[0]?.prepared.evidence.sources, ["agent:cos", "native:paid-media"]);
assert.equal(native.accepted[0]?.prepared.record.baseline, 80);
assert.equal(native.accepted[0]?.prepared.estimatedImpactUsd, "500.00");

const stale = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-later",
      format: "1.1",
      client: "hvac-usa",
      store: "hvac-usa/web",
      source: "native:paid-media",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "unknown", layer: "none" },
      target: "google_ads:campaign:123",
      dedupe_key: "hvac-usa/web|google_ads:campaign:123|google_search|lower the daily budget",
      skill: "paid-media",
      channel: "google_search",
      group: "do_now",
      finding: "Outside the window.",
      why_plain: "This is a new week.",
      change: { from: "daily budget 40", to: "lower the daily budget" },
      rollback: "Set the daily budget back to 40.",
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  {
    clientSlug: "hvac-usa",
    now: new Date(new Date("2026-10-05T18:00:00Z").getTime() + DEDUPE_WINDOW_MS + 60_000),
    existing: [{ id: "existing-1", createdAt: "2026-10-05T18:00:00Z", status: "proposed", prepared: first.prepared }],
  },
);
assert.equal(stale.accepted[0]?.mergeIntoId, null);

const mismatch = ingestRecommendationRecords(
  [
    {
      id: "REC-hvac-usa-bad-key",
      format: "1.1",
      client: "hvac-usa",
      store: "all",
      source: "agent:cos",
      versions: { skill: "paid-media@0.4.1-accepted", pack: "unknown", layer: "none" },
      target: "x",
      dedupe_key: "not-the-formula",
      skill: "paid-media",
      channel: "seo",
      group: "test",
      finding: "Bad key.",
      approval: { status: "PENDING_APPROVAL" },
    },
  ],
  { clientSlug: "hvac-usa" },
);
assert.match(mismatch.rejected[0]?.reasons.join(" ") ?? "", /dedupe_key/);

assert.equal(
  canonicalDedupeKey({
    store: "hvac-usa/web",
    target: "google_ads:campaign:123",
    channel: "google_search",
    change: { to: "  Lower   the daily budget " },
  }),
  "hvac-usa/web|google_ads:campaign:123|google_search|lower the daily budget",
);

console.log("ingest tests ok");
