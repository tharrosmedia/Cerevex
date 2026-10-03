import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareCodePoint } from "../src/manifest";
import { snapshotTimestamp } from "../src/snapshot-time";

assert.equal(snapshotTimestamp("2026-10-03-0720"), "2026-10-03T07:20:00-04:00");
assert.equal(snapshotTimestamp("2026-01-15-0930"), "2026-01-15T09:30:00-05:00");
assert.equal(compareCodePoint("references/README", "verticals/README"), -1);

const resync = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/resync.ts"),
  "utf8",
);
assert.equal(resync.includes("-04:00"), false);
assert.match(resync, /snapshotTimestamp/);
assert.match(resync, /archiveSha256/);

console.log("snapshot time tests ok");
