import assert from "node:assert/strict";
import {
  DEFAULT_APPROVAL_OWNER_IDENTITY,
  classifyProfileValue,
  decomposeProfileValue,
  resolveApprovalOwner,
  valueForClientFacingCopy,
} from "../src/fact";
import { makeFact } from "../src/fact";

const known = classifyProfileValue("Lennox and Trane, sold online");
assert.equal(known.state, "known");
assert.equal(known.value, "Lennox and Trane, sold online");

const tbd = classifyProfileValue("TBD");
assert.equal(tbd.state, "tbd");
assert.equal(tbd.value, null);

const inference = classifyProfileValue("likely lead-gen for agency services: inference, confirm");
assert.equal(inference.state, "inference");
assert.equal(valueForClientFacingCopy({ ...inference, source: null, asOf: null, raw: inference.value ?? "" }), null);

const assumption = classifyProfileValue("ships from Kansas City. **CONFIRM** both");
assert.equal(assumption.state, "assumption");
assert.equal(valueForClientFacingCopy({ state: "assumption", value: assumption.value, source: "x", asOf: "2026-09-29", raw: "" }), null);

const internal = classifyProfileValue("Lennox is more competitive on price online", { key: "internal context" });
assert.equal(internal.state, "inference");

const none = classifyProfileValue("none (not marketed)");
assert.equal(none.state, "known");
assert.equal(none.value, "none (not marketed)");

const split = decomposeProfileValue(
  "order value and gross margin by product line; AOV TBD; repeat/contractor LTV TBD",
  "value model",
);
assert.equal(split.primary.state, "known");
assert.match(split.primary.value ?? "", /order value/);
assert.equal(split.parts.filter((part) => part.state === "tbd").length, 2);

const owner = resolveApprovalOwner(makeFact("TBD", null, null, "approval_owner"));
assert.equal(owner.name, DEFAULT_APPROVAL_OWNER_IDENTITY);
assert.equal(owner.name, "agency owner (Adam Leech)");
assert.equal("email" in owner, false);
assert.equal(owner.resolvedFrom, "tbd-default");

const agency = resolveApprovalOwner(makeFact("agency owner", "profile", "2026-09-29", "approval_owner"));
assert.equal(agency.name, "agency owner (Adam Leech)");
assert.equal(agency.resolvedFrom, "agency-owner");

const named = resolveApprovalOwner(makeFact("Jordan Lee", "profile", "2026-09-29", "approval_owner"));
assert.equal(named.name, "Jordan Lee");
assert.equal(named.resolvedFrom, "profile");

console.log("fact tests ok");
