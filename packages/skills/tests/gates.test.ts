import assert from "node:assert/strict";
import {
  SkillGateError,
  assertSkillRunAllowed,
  evaluateSkillRun,
  isLevelAgencyTenant,
} from "../src/gates";

const blocked = ["Edge NYC", "edge-nyc", "Vessel NYC", "Kiavi", "Perfect Lens World", "Perfect Lens CA", "Perfect Lens World/CA", "Lenspure"];
for (const name of blocked) {
  assert.equal(isLevelAgencyTenant(name), true, name);
  for (const runKind of ["marketing", "qualified-outcome", "internal-record"] as const) {
    const decision = evaluateSkillRun({ clientSlug: name, runKind, marketingGate: "off" });
    assert.equal(decision.allowed, false, `${name} ${runKind}`);
    assert.equal(decision.gate, "scope");
  }
}

assert.equal(evaluateSkillRun({ clientSlug: "someone-else", runKind: "internal-record" }).allowed, false);

const cerevexMarketing = evaluateSkillRun({
  clientSlug: "cerevex",
  runKind: "marketing",
  marketingGate: "on",
});
assert.equal(cerevexMarketing.allowed, false);
assert.equal(cerevexMarketing.gate, "marketing");

const cerevexOutcome = evaluateSkillRun({
  clientSlug: "cerevex",
  runKind: "qualified-outcome",
  marketingGate: "on",
});
assert.equal(cerevexOutcome.allowed, false);
assert.equal(cerevexOutcome.gate, "marketing");

const cerevexRecord = evaluateSkillRun({
  clientSlug: "cerevex",
  runKind: "internal-record",
  marketingGate: "on",
});
assert.equal(cerevexRecord.allowed, true);

const cerevexMissingGate = evaluateSkillRun({ clientSlug: "cerevex", runKind: "marketing" });
assert.equal(cerevexMissingGate.allowed, false);
assert.equal(cerevexMissingGate.gate, "marketing");
assert.equal(
  evaluateSkillRun({ clientSlug: "Cerevex", runKind: "qualified-outcome", marketingGate: null }).allowed,
  false,
);
assert.equal(evaluateSkillRun({ clientSlug: "cerevex", runKind: "internal-record" }).allowed, true);
assert.equal(evaluateSkillRun({ clientSlug: "cerevex", runKind: "marketing", marketingGate: "off" }).allowed, true);
assert.equal(evaluateSkillRun({ clientSlug: "hvac-usa", runKind: "marketing" }).allowed, true);

assert.equal(
  evaluateSkillRun({ clientSlug: "hvac-usa", runKind: "marketing", marketingGate: "off" }).allowed,
  true,
);

assert.throws(
  () => assertSkillRunAllowed({ clientSlug: "kiavi", runKind: "marketing", marketingGate: "off" }),
  SkillGateError,
);

console.log("gate tests ok");
