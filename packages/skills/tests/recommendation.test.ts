import assert from "node:assert/strict";
import {
  RecommendationValidationError,
  SkillJobApprovalError,
  normalizeRecommendation,
  pendingApprovalRecord,
  sealSkillJobApproval,
  validateRecommendation,
} from "../src/recommendation";

const recordV1 = {
  id: "REC-hvac-usa-20260929-1",
  client: "hvac-usa",
  skill: "paid-media",
  channel: "google_search",
  group: "do_now",
  finding: "Search spend is above the qualified-outcome cost.",
  approval: {
    status: "PENDING_APPROVAL",
    approver: "agency owner",
    path: "tharros",
    executed_by: "human",
  },
};

const normalized = normalizeRecommendation(recordV1);
assert.equal(normalized.format, "1.0");
assert.equal(normalized.store, "all");
assert.equal(normalized.source, "agent:unknown");
assert.equal(normalized.versions.skill, "unknown");
assert.equal(normalized.approval.executed_by, "human");

const recordV11 = {
  ...recordV1,
  format: "1.1",
  store: "hvac-usa/web",
  source: "native:paid-media",
  versions: { skill: "paid-media@0.4.1-accepted", pack: "ecommerce-dtc@4.1.0", layer: "none" },
  target: "google_ads:campaign:123",
  dedupe_key: "hvac-usa/web|google_ads:campaign:123|google_search|lower budget",
  approval: {
    status: "approved",
    approver: "agency owner (Adam Leech)",
    approved_by: "agency owner (Adam Leech)",
    approved_at: "2026-10-03T12:00:00Z",
    executed_by: "cerevex_apply",
    executed_at: "2026-10-03T12:05:00Z",
    apply_result: "success",
    rolled_back_by: null,
    rolled_back_at: null,
  },
};
const validated = validateRecommendation(recordV11);
assert.equal(validated.format, "1.1");
assert.equal(validated.approval.executed_by, "cerevex_apply");
assert.equal(normalizeRecommendation(recordV11).source, "native:paid-media");

assert.throws(
  () => validateRecommendation({ ...recordV11, executed_by: "cerevex_apply" }),
  RecommendationValidationError,
);

assert.throws(
  () => validateRecommendation({ ...recordV11, source: undefined, format: "1.1" }),
  RecommendationValidationError,
);

assert.throws(
  () =>
    validateRecommendation({
      ...recordV11,
      approval: { ...recordV11.approval, executed_by: "robot" },
    }),
  RecommendationValidationError,
);

assert.equal(sealSkillJobApproval(undefined).status, "PENDING_APPROVAL");
assert.equal(sealSkillJobApproval({ status: "PENDING_APPROVAL" }).executed_by, null);
assert.throws(
  () => sealSkillJobApproval({ status: "approved", approved_by: "a skill" }),
  SkillJobApprovalError,
);
assert.throws(
  () => sealSkillJobApproval({ status: "PENDING_APPROVAL", executed_by: "cerevex_apply" }),
  SkillJobApprovalError,
);
assert.equal(pendingApprovalRecord().status, "PENDING_APPROVAL");

console.log("recommendation tests ok");
