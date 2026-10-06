import assert from "node:assert/strict";
import {
  CHECKED_LOOPS,
  NOT_CHECKED_LOOPS,
  runAccountReview,
} from "../src/account-review";
import { SkillGateError } from "../src/gates";
import { importProfiles } from "../src/import-profiles";
import { SKILL_MODEL_PINS } from "../src/resolved-prompt";

const bundle = importProfiles();
const hvac = bundle.clients.find((client) => client.slug === "hvac-usa");
const got = bundle.clients.find((client) => client.slug === "got-ductless");
const cerevex = bundle.clients.find((client) => client.slug === "cerevex");
assert.ok(hvac && got && cerevex);

const now = new Date("2026-10-06T15:00:00Z");
const review = runAccountReview(hvac, { now, runId: "week-1", gscRowCount: 4, keyword: "lennox furnace" });

assert.equal(review.packet.cadence, "weekly");
assert.equal(review.packet.weekOf, "2026-10-06");
assert.equal(review.packet.modelId, SKILL_MODEL_PINS["account-review-loop"]);
assert.equal(review.packet.modelId, "grok-4.6");
assert.equal(review.spend.usd, 0);
assert.equal(review.spend.capped, false);
assert.equal(review.spend.modelCall, "not_made");
assert.equal(review.resolved.layerVersion, "hvac-usa@v1");
assert.match(review.resolved.templateVersion, /^account-review-loop@/);
assert.deepEqual(
  review.packet.checked.map((line) => line.loop),
  [...CHECKED_LOOPS],
);
assert.ok(review.packet.checked.every((line) => line.status === "checked"));
assert.deepEqual(
  review.packet.notChecked.map((line) => line.loop),
  [...NOT_CHECKED_LOOPS],
);
assert.ok(review.packet.notChecked.every((line) => line.status === "not_checked"));
assert.equal(review.packet.notChecked.some((line) => line.loop === "Paid review"), false);
assert.ok(review.packet.sourcesNotChecked.includes("LSA"));
assert.ok(review.packet.sourcesNotChecked.includes("GBP"));
assert.equal(review.runs.length, 4);
assert.equal(review.packet.counts.needsData, review.runs.reduce((sum, run) => sum + run.ingest.accepted.length, 0));
assert.equal(review.packet.counts.doNow, 0);
assert.equal(review.packet.counts.test, 0);
assert.equal(review.packet.topApprovals.length, 0);
assert.equal(review.packet.nothingToActOn, true);
assert.equal(review.packet.note, "Checked, nothing to act on.");
assert.ok(review.runs.every((run) => run.ingest.rejected.length === 0));
assert.match(
  review.runs.find((run) => run.job === "seo-audit")?.ingest.accepted[0]?.prepared.title ?? "",
  /Search Console has 4 rows/,
);

const dumped = JSON.stringify(review.packet);
assert.equal(dumped.includes("local-ductless-stores"), false);
assert.equal(dumped.includes("913"), false);
assert.equal("text" in review.packet, false);

assert.throws(() => runAccountReview(got, { now }), SkillGateError);
assert.throws(() => runAccountReview(cerevex, { now }), SkillGateError);

console.log("account-review ok");
