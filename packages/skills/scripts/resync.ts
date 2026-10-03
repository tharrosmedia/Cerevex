/**
 * Replace the vendored skill and shared-reference snapshots, then rebuild
 * the manifest and the imported client configs.
 *
 *   npm run resync --workspace=@cerevex/skills -- \
 *     --references path/to/tharros-shared-references-YYYY-MM-DD-HHMM.tar.gz \
 *     --skills path/to/skills-six-YYYY-MM-DD-HHMM-accepted.tar.gz \
 *     --overlay no-slop-copy=path/to/no-slop-copy-YYYY-MM-DD-HHMM.tar.gz
 *
 * Both main archives must carry the same YYYY-MM-DD-HHMM stamp. The stamp is
 * read as America/New_York (ET). Repeat --overlay to replace one skill folder
 * after the skills archive is extracted. Runtime never reads the box or Drive.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildManifest, sha256 } from "../src/manifest";
import { importProfiles } from "../src/import-profiles";
import { SNAPSHOT_TIMEZONE, snapshotTimestamp } from "../src/snapshot-time";
import {
  CLIENT_CONFIG_PATH,
  GENERATED_DIR,
  MANIFEST_PATH,
  REFERENCES_ROOT,
  SKILLS_CONTENT_ROOT,
  SNAPSHOT_PATH,
  VENDOR_ROOT,
} from "../src/paths";

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing ${name}. See packages/skills/README.md.`);
  }
  return value;
}

function snapshotIdFrom(file: string): string {
  const match = path.basename(file).match(/(\d{4}-\d{2}-\d{2}-\d{4})/);
  if (!match) throw new Error(`Cannot read a YYYY-MM-DD-HHMM stamp from ${file}`);
  return match[1];
}

function archiveSha256(file: string): string {
  return sha256(readFileSync(file));
}

function overlays(): Array<{ name: string; archive: string }> {
  const found: Array<{ name: string; archive: string }> = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--overlay") continue;
    const value = process.argv[index + 1];
    const splitAt = value?.indexOf("=") ?? -1;
    if (!value || splitAt <= 0) {
      throw new Error("--overlay expects name=/path/to/skill.tar.gz");
    }
    found.push({ name: value.slice(0, splitAt), archive: path.resolve(value.slice(splitAt + 1)) });
  }
  return found;
}

const referencesArchive = path.resolve(arg("--references"));
const skillsArchive = path.resolve(arg("--skills"));
const skillOverlays = overlays();
const referencesId = snapshotIdFrom(referencesArchive);
const skillsId = snapshotIdFrom(skillsArchive);
if (referencesId !== skillsId) {
  throw new Error(`Snapshot stamps differ: references ${referencesId}, skills ${skillsId}`);
}

const temp = mkdtempSync(path.join(tmpdir(), "cerevex-skills-resync-"));
try {
  execFileSync("tar", ["-xzf", referencesArchive, "-C", temp], { stdio: "inherit" });
  const extractedRefs = path.join(temp, "tharros-shared-references");
  const extractedSkills = path.join(temp, "skills");
  mkdirSync(extractedSkills, { recursive: true });
  execFileSync("tar", ["-xzf", skillsArchive, "-C", extractedSkills], { stdio: "inherit" });

  rmSync(REFERENCES_ROOT, { recursive: true, force: true });
  rmSync(SKILLS_CONTENT_ROOT, { recursive: true, force: true });
  mkdirSync(VENDOR_ROOT, { recursive: true });
  cpSync(extractedRefs, REFERENCES_ROOT, { recursive: true });
  cpSync(extractedSkills, SKILLS_CONTENT_ROOT, { recursive: true });

  for (const overlay of skillOverlays) {
    const overlayTemp = path.join(temp, `overlay-${overlay.name}`);
    mkdirSync(overlayTemp, { recursive: true });
    execFileSync("tar", ["-xzf", overlay.archive, "-C", overlayTemp], { stdio: "inherit" });
    const overlayDir = path.join(overlayTemp, overlay.name);
    if (!existsSync(overlayDir)) {
      throw new Error(`Overlay archive has no ${overlay.name}/ directory`);
    }
    rmSync(path.join(SKILLS_CONTENT_ROOT, overlay.name), { recursive: true, force: true });
    cpSync(overlayDir, path.join(SKILLS_CONTENT_ROOT, overlay.name), { recursive: true });
  }

  const snapshot = {
    snapshotId: referencesId,
    snapshotTimestamp: snapshotTimestamp(referencesId),
    timezone: SNAPSHOT_TIMEZONE,
    recordedFrom:
      "Vendored from the box library /home/box/agent-data/workflows/ as of the snapshot stamp in America/New_York. Cerevex does not read the box or Drive at runtime.",
    sources: [
      {
        kind: "tharros-shared-references",
        archiveName: path.basename(referencesArchive),
        sha256: archiveSha256(referencesArchive),
        upstreamPath: "/home/box/agent-data/workflows/tharros-shared-references",
        vendoredPath: "packages/skills/vendor/tharros-shared-references",
        status: "accepted",
      },
      {
        kind: "skills",
        archiveName: path.basename(skillsArchive),
        sha256: archiveSha256(skillsArchive),
        upstreamPath:
          "/home/box/agent-data/workflows/{paid-media,seo-audit,seo-research,claims-check,no-slop-copy,account-review-loop}",
        vendoredPath: "packages/skills/vendor/skills",
        status: "accepted",
      },
      ...skillOverlays.map((overlay) => ({
        kind: "skill-overlay",
        skill: overlay.name,
        archiveName: path.basename(overlay.archive),
        sha256: archiveSha256(overlay.archive),
        upstreamPath: `/home/box/agent-data/workflows/${overlay.name}`,
        vendoredPath: `packages/skills/vendor/skills/${overlay.name}`,
        status: "accepted",
      })),
    ],
  };
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);

  mkdirSync(GENERATED_DIR, { recursive: true });
  const manifest = buildManifest();
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const bundle = importProfiles();
  writeFileSync(CLIENT_CONFIG_PATH, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        snapshotId: snapshot.snapshotId,
        snapshotTimestamp: snapshot.snapshotTimestamp,
        pins: manifest.entries.length,
        clients: bundle.clients.map((client) => client.slug),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
