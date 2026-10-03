import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REFERENCES_DIR } from "../src/paths";
import { STALENESS_WINDOW_DAYS, classifyDatedRow, parseVerifiedFactRows } from "../src/staleness";

assert.equal(STALENESS_WINDOW_DAYS, 90);

const fresh = classifyDatedRow(
  { fact: "A platform rule", verifyAsOf: "2026-09-29", source: "vendor" },
  "2026-10-03",
);
assert.equal(fresh.state, "known");

const stale = classifyDatedRow(
  { fact: "An old rule", verifyAsOf: "2026-06-01", source: "vendor" },
  "2026-10-03",
);
assert.equal(stale.state, "assumption");

const marked = classifyDatedRow(
  { fact: "TCPA hours", verifyAsOf: "Not re-verified 2026-09-29", source: "47 CFR" },
  "2026-10-03",
);
assert.equal(marked.state, "assumption");

const rows = parseVerifiedFactRows(
  readFileSync(path.join(REFERENCES_DIR, "verified-facts.md"), "utf8"),
);
assert.ok(rows.length >= 5);
assert.equal(
  rows.some((row) => /Not re-verified/.test(row.verifyAsOf)),
  true,
);
assert.equal(
  classifyDatedRow(
    rows.find((row) => /Not re-verified/.test(row.verifyAsOf))!,
    "2026-10-03",
  ).state,
  "assumption",
);

console.log("staleness tests ok");
