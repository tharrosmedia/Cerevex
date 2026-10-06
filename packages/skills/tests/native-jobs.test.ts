import assert from "node:assert/strict";
import { SkillGateError } from "../src/gates";
import { importProfiles } from "../src/import-profiles";
import { runPaidMediaJob, runSeoAuditJob, runSeoResearchJob } from "../src/native-jobs";
import { HVAC_USA_LAYER_VERSION, seedPromptLayer } from "../src/prompt-seed";
import { SKILL_MODEL_PINS } from "../src/resolved-prompt";

const bundle = importProfiles();
const hvac = bundle.clients.find((client) => client.slug === "hvac-usa");
const got = bundle.clients.find((client) => client.slug === "got-ductless");
const cerevex = bundle.clients.find((client) => client.slug === "cerevex");
assert.ok(hvac && got && cerevex);

assert.equal(hvac.promptLayer.seeded, true);
assert.equal(hvac.promptLayer.version, HVAC_USA_LAYER_VERSION);
assert.equal(got.promptLayer.seeded, false);
assert.equal(seedPromptLayer(got), null);

const layer = seedPromptLayer(hvac);
assert.ok(layer);
assert.match(layer.markdown, /cites brands/);
assert.match(layer.markdown, /Lennox/);
assert.match(layer.markdown, /Cage/);
assert.match(layer.markdown, /local-ductless-stores/);
assert.ok(layer.rules.every((rule) => rule.cites.length > 0));

const now = new Date("2026-10-06T15:00:00Z");
const google = runPaidMediaJob(hvac, "google", { now, runId: "run-google" });
assert.equal(google.ingest.rejected.length, 0);
assert.ok(google.ingest.accepted.length >= 3);
assert.ok(google.ingest.accepted.every((row) => row.prepared.evidence.group === "needs_data"));
assert.ok(google.ingest.accepted.every((row) => row.prepared.evidence.approveHidden));
assert.equal(google.ingest.accepted[0]?.prepared.evidence.source, "native:paid-media");
assert.equal(google.resolved.layerVersion, HVAC_USA_LAYER_VERSION);
assert.equal(google.resolved.modelId, SKILL_MODEL_PINS["paid-media"]);
assert.equal(google.resolved.modelId, "grok-4.6");
assert.equal(google.spend.capped, false);
assert.equal(google.spend.usd, 0);
assert.equal(google.spend.modelCall, "not_made");
assert.equal(google.spend.modelId, google.resolved.modelId);
assert.equal(google.spend.promptHash, google.resolved.promptHash);
assert.match(google.resolved.templateVersion, /^paid-media@/);
assert.match(google.resolved.packVersion, /^ecommerce-dtc@/);
assert.ok(google.notChecked.includes("LSA"));
assert.equal(JSON.stringify(google.ingest.accepted).includes("local-ductless-stores"), false);

const meta = runPaidMediaJob(hvac, "meta", { now, runId: "run-meta" });
assert.equal(meta.ingest.rejected.length, 0);
assert.notEqual(meta.ingest.accepted[0]?.prepared.evidence.dedupeKey, google.ingest.accepted[0]?.prepared.evidence.dedupeKey);

const audit = runSeoAuditJob(hvac, { now, runId: "run-audit" });
assert.equal(audit.ingest.rejected.length, 0);
assert.equal(audit.ingest.accepted[0]?.prepared.evidence.source, "native:seo-audit");
assert.match(audit.resolved.templateVersion, /^seo-audit@/);
assert.equal(audit.spend.modelId, "grok-4.6");
assert.ok(audit.notChecked.includes("GBP"));

const withRows = runSeoAuditJob(hvac, { now, gscRowCount: 12, runId: "run-audit-rows" });
assert.match(withRows.ingest.accepted[0]?.prepared.record.finding ?? "", /12 rows/);

const research = runSeoResearchJob(hvac, { now, keyword: "lennox furnace", runId: "run-research" });
assert.equal(research.ingest.rejected.length, 0);
assert.match(research.ingest.accepted[0]?.prepared.record.finding ?? "", /lennox furnace/);
assert.match(research.ingest.accepted[0]?.prepared.record.finding ?? "", /SERP/);
assert.equal(research.ingest.accepted[0]?.prepared.evidence.versions.layer, HVAC_USA_LAYER_VERSION);
assert.doesNotMatch(research.ingest.accepted[0]?.prepared.record.finding ?? "", /local-ductless/);

const missingKeyword = runSeoResearchJob(hvac, { now, runId: "run-research-empty" });
assert.match(missingKeyword.ingest.accepted[0]?.prepared.record.finding ?? "", /primary keyword/);

assert.throws(() => runPaidMediaJob(got, "google", { now }), SkillGateError);
assert.throws(() => runSeoAuditJob(cerevex, { now }), SkillGateError);

console.log("native job tests ok");
