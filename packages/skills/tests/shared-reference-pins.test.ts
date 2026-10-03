import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REFERENCES_ROOT } from "../src/paths";
import {
  DEFAULT_SKILLS_SOURCE,
  SHARED_REFERENCE_OVERLAY_ROOT,
  loadSharedReferencePins,
  sha256File,
  verifySharedReferencePins,
} from "../src/shared-reference-pins";

const pins = loadSharedReferencePins();
const prompt = pins.find((pin) => pin.path === "references/prompt-layer.md");
if (!prompt) throw new Error("prompt-layer pin missing");
assert.equal(prompt.sha256, "69e3d463c490519ad80603125d872ce5aa29cae20580cb3bb19c4108f73097e9");
assert.equal(sha256File(path.join(REFERENCES_ROOT, prompt.path)), prompt.sha256);
assert.equal(sha256File(path.join(SHARED_REFERENCE_OVERLAY_ROOT, prompt.path)), prompt.sha256);
verifySharedReferencePins(REFERENCES_ROOT, pins);
verifySharedReferencePins(SHARED_REFERENCE_OVERLAY_ROOT, pins);

const temp = mkdtempSync(path.join(tmpdir(), "cerevex-pin-"));
try {
  const dest = path.join(temp, prompt.path);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, "version 1.0\n");
  assert.throws(
    () => verifySharedReferencePins(temp, pins),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      return (
        message.includes("sha256 mismatch") &&
        message.includes(prompt.sha256) &&
        message.includes("Refusing to replace vendor/")
      );
    },
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resync = readFileSync(path.join(packageRoot, "scripts/resync.ts"), "utf8");
const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8");
assert.equal(resync.includes("-04:00"), false);
assert.match(resync, /snapshotTimestamp/);
assert.match(resync, /--source/);
assert.match(resync, /verifySharedReferencePins/);
assert.match(resync, new RegExp(DEFAULT_SKILLS_SOURCE.replaceAll("/", "\\/")));
assert.match(readme, /--source/);
assert.match(readme, new RegExp(DEFAULT_SKILLS_SOURCE.replaceAll("/", "\\/")));
assert.match(readme, /69e3d463c490519ad80603125d872ce5aa29cae20580cb3bb19c4108f73097e9/);

console.log("shared reference pin tests ok");
