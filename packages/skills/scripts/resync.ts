/**
 * Re-sync vendored skills from the live workflows tree.
 *
 *   npm run resync --workspace=@cerevex/skills -- --source /home/box/agent-data/workflows
 *
 * --source defaults to /home/box/agent-data/workflows. The script copies
 * tharros-shared-references and each skill folder from that directory.
 * It checks prompt-layer.md, and every other pinned shared reference, against
 * pins/shared-references.json and against overlays/shared-references/.
 * A sha256 mismatch throws before vendor/ is replaced, so prompt-layer 1.0.1
 * survives. Archive snapshots are not a source.
 *
 * Optional --overlay name=/path/to/skill-dir replaces one skill folder after
 * the source copy. Optional --stamp YYYY-MM-DD-HHMM overrides the snapshot id.
 * The stamp is read as America/New_York.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SKILLS_PACKAGE_ROOT, SNAPSHOT_PATH, readSnapshot } from "../src/paths";
import {
  DEFAULT_SKILLS_SOURCE,
  SHARED_REFERENCE_OVERLAY_ROOT,
  assertNoSymlinks,
  loadSharedReferencePins,
  verifySharedReferencePins,
} from "../src/shared-reference-pins";
import { snapshotTimestamp } from "../src/snapshot-time";
import { SKILL_SLUGS, type SkillSlug } from "../src/types";

const REFERENCES_DIR_NAME = "tharros-shared-references";
const STAMP_RE = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function skillOverlays(): Array<{ name: string; dir: string }> {
  const found: Array<{ name: string; dir: string }> = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--overlay") continue;
    const value = process.argv[index + 1];
    const split = value?.indexOf("=") ?? -1;
    if (!value || split <= 0) throw new Error("--overlay expects name=/path/to/skill-dir");
    found.push({ name: value.slice(0, split), dir: path.resolve(value.slice(split + 1)) });
  }
  return found;
}

if (process.argv.includes("--references") || process.argv.includes("--skills")) {
  throw new Error(
    "Re-sync reads a workflows directory via --source (default /home/box/agent-data/workflows). Archive flags are not accepted.",
  );
}

const source = path.resolve(flagValue("--source") ?? DEFAULT_SKILLS_SOURCE);
const overlays = skillOverlays();
const pins = loadSharedReferencePins();
const referencesSource = path.join(source, REFERENCES_DIR_NAME);

if (!existsSync(referencesSource)) {
  throw new Error(
    `Cannot read shared references at ${referencesSource}. Pass --source <dir> (default ${DEFAULT_SKILLS_SOURCE}).`,
  );
}
for (const slug of SKILL_SLUGS) {
  const skillDir = path.join(source, slug);
  if (!existsSync(skillDir)) throw new Error(`Cannot read skill ${slug} at ${skillDir}.`);
}
for (const overlay of overlays) {
  if (!SKILL_SLUGS.includes(overlay.name as SkillSlug)) {
    throw new Error(`Unknown skill overlay ${overlay.name}.`);
  }
  if (!existsSync(overlay.dir)) throw new Error(`Skill overlay directory missing: ${overlay.dir}`);
}

verifySharedReferencePins(SHARED_REFERENCE_OVERLAY_ROOT, pins);

const temp = mkdtempSync(path.join(tmpdir(), "cerevex-skills-resync-"));
const stagedReferences = path.join(temp, REFERENCES_DIR_NAME);
const stagedSkills = path.join(temp, "skills");
cpSync(referencesSource, stagedReferences, { recursive: true });
verifySharedReferencePins(stagedReferences, pins);
cpSync(SHARED_REFERENCE_OVERLAY_ROOT, stagedReferences, { recursive: true });
verifySharedReferencePins(stagedReferences, pins);

mkdirSync(stagedSkills, { recursive: true });
for (const slug of SKILL_SLUGS) {
  cpSync(path.join(source, slug), path.join(stagedSkills, slug), { recursive: true });
}
for (const overlay of overlays) {
  const dest = path.join(stagedSkills, overlay.name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(overlay.dir, dest, { recursive: true });
}

assertNoSymlinks(source);
assertNoSymlinks(SHARED_REFERENCE_OVERLAY_ROOT);
for (const overlay of overlays) assertNoSymlinks(overlay.dir);
assertNoSymlinks(stagedReferences);
assertNoSymlinks(stagedSkills);

const vendor = path.join(SKILLS_PACKAGE_ROOT, "vendor");
rmSync(path.join(vendor, REFERENCES_DIR_NAME), { recursive: true, force: true });
rmSync(path.join(vendor, "skills"), { recursive: true, force: true });
cpSync(stagedReferences, path.join(vendor, REFERENCES_DIR_NAME), { recursive: true });
cpSync(stagedSkills, path.join(vendor, "skills"), { recursive: true });

const previous = existsSync(SNAPSHOT_PATH) ? readSnapshot() : undefined;
const stamp = flagValue("--stamp") ?? previous?.snapshotId ?? "";
if (!STAMP_RE.test(stamp)) {
  throw new Error("--stamp must be YYYY-MM-DD-HHMM when the current snapshot id is not already in that form.");
}

const snapshot = {
  snapshotId: stamp,
  snapshotTimestamp: snapshotTimestamp(stamp),
  timezone: "America/New_York",
  recordedFrom: `Vendored from ${source}. Pinned shared references were checked against pins/shared-references.json and overlays/shared-references/ before vendor/ was replaced. Cerevex does not read the box or Drive at runtime.`,
  pins: pins.map((pin) => ({ path: pin.path, sha256: pin.sha256 })),
  sources: [
    {
      kind: "workflows-directory",
      archiveName: source,
      upstreamPath: source,
      vendoredPath: "vendor/",
      status: "copied",
      note: "Shared-reference pins were verified before this copy.",
    },
    ...overlays.map((overlay) => ({
      kind: "skill-overlay",
      archiveName: overlay.dir,
      upstreamPath: overlay.dir,
      vendoredPath: `vendor/skills/${overlay.name}`,
      status: "replaced",
    })),
  ],
};

writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
const repoRoot = path.resolve(SKILLS_PACKAGE_ROOT, "../..");
execFileSync("npm", ["run", "manifest", "--workspace=@cerevex/skills"], {
  cwd: repoRoot,
  stdio: "inherit",
});
execFileSync("npm", ["run", "import", "--workspace=@cerevex/skills"], {
  cwd: repoRoot,
  stdio: "inherit",
});
rmSync(temp, { recursive: true, force: true });
console.log(`Resynced skills from ${source} at ${snapshot.snapshotTimestamp}.`);
