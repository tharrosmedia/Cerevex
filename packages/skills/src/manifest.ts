import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  REFERENCES_DIR,
  REFERENCES_ROOT,
  SKILLS_CONTENT_ROOT,
  readSnapshot,
} from "./paths";
import type { ManifestEntry, ManifestFile, ManifestKind, SkillSlug, SkillsManifest } from "./types";
import { SKILL_SLUGS } from "./types";

export const HASH_ALGORITHM = "sha256-sorted-path-v1" as const;

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
      if (name === ".DS_Store") continue;
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(rel);
    }
  };
  walk(root);
  return out;
}

export function hashFiles(root: string, relativeFiles: readonly string[]): {
  contentHash: string;
  files: ManifestFile[];
} {
  const files = relativeFiles.map((rel) => {
    const buf = readFileSync(path.join(root, rel));
    return { path: rel, sha256: sha256(buf) };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return { contentHash: hash.digest("hex"), files };
}

/**
 * Version pin is the first `> version` or `> Format version` banner after
 * frontmatter. YAML metadata.version is not the pin.
 */
export function readBannerVersion(markdown: string): string | null {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const match = body.match(/^>\s*(?:Format\s+)?version\s+(\S+)/m);
  return match?.[1] ?? null;
}

export function readLibraryVersion(skillMarkdown: string): string {
  const match = skillMarkdown.match(/Tharros shared references \(v(\d+)\.(\d+)\)/);
  if (!match) throw new Error("Shared library SKILL.md has no vX.Y heading");
  return `${match[1]}.${match[2]}.0`;
}

interface RefSpec {
  slug: string;
  root: string;
  files: string[];
  versionFile?: string;
}

function skillEntry(slug: SkillSlug): ManifestEntry {
  const root = path.join(SKILLS_CONTENT_ROOT, slug);
  const files = listFiles(root);
  const skillMd = readFileSync(path.join(root, "SKILL.md"), "utf8");
  const version = readBannerVersion(skillMd);
  if (!version) throw new Error(`${slug} SKILL.md has no > version banner`);
  const hashed = hashFiles(root, files);
  return {
    slug,
    kind: "skill",
    version,
    versionSource: "banner",
    contentHash: hashed.contentHash,
    files: hashed.files,
  };
}

function refEntry(spec: RefSpec, libraryVersion: string): ManifestEntry {
  const versionFile = spec.versionFile ?? spec.files[0];
  const markdown = readFileSync(path.join(spec.root, versionFile), "utf8");
  const banner = versionFile.endsWith(".md") ? readBannerVersion(markdown) : null;
  const hashed = hashFiles(spec.root, spec.files);
  return {
    slug: spec.slug,
    kind: "shared-ref" satisfies ManifestKind,
    version: banner ?? libraryVersion,
    versionSource: banner ? "banner" : "library-skill-header",
    contentHash: hashed.contentHash,
    files: hashed.files,
  };
}

function sharedRefSpecs(): RefSpec[] {
  const specs: RefSpec[] = [
    {
      slug: "tharros-shared-references",
      root: REFERENCES_ROOT,
      files: ["SKILL.md"],
    },
    {
      slug: "prompt-layer",
      root: REFERENCES_DIR,
      files: ["prompt-layer.md"],
      versionFile: "prompt-layer.md",
    },
    {
      slug: "cerevex-recommendation-format",
      root: REFERENCES_DIR,
      files: ["cerevex-recommendation-format.md"],
      versionFile: "cerevex-recommendation-format.md",
    },
    {
      slug: "verified-facts",
      root: REFERENCES_DIR,
      files: ["verified-facts.md"],
    },
    {
      slug: "outcome-economics",
      root: REFERENCES_DIR,
      files: ["outcome-economics.md"],
    },
    {
      slug: "lead-classifier",
      root: REFERENCES_DIR,
      files: ["lead-classifier.md"],
    },
    {
      slug: "licenses",
      root: REFERENCES_DIR,
      files: ["LICENSES.md"],
    },
    {
      slug: "clients-roster",
      root: path.join(REFERENCES_DIR, "clients"),
      files: ["README.md"],
    },
  ];
  for (const pack of ["home-service", "ecommerce-dtc", "saas-b2b", "local-other"]) {
    const root = path.join(REFERENCES_DIR, "verticals", pack);
    specs.push({
      slug: `verticals/${pack}`,
      root,
      files: listFiles(root),
    });
  }
  const clientRoot = path.join(REFERENCES_DIR, "clients");
  for (const slug of readdirSync(clientRoot).sort((a, b) => a.localeCompare(b))) {
    const dir = path.join(clientRoot, slug);
    if (!statSync(dir).isDirectory()) continue;
    specs.push({
      slug: `clients/${slug}`,
      root: dir,
      files: listFiles(dir),
    });
  }
  return specs;
}

export function buildManifest(): SkillsManifest {
  const snapshot = readSnapshot();
  const librarySkill = readFileSync(path.join(REFERENCES_ROOT, "SKILL.md"), "utf8");
  const libraryVersion = readLibraryVersion(librarySkill);
  const entries: ManifestEntry[] = [
    ...SKILL_SLUGS.map((slug) => skillEntry(slug)),
    ...sharedRefSpecs().map((spec) => refEntry(spec, libraryVersion)),
  ];
  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug));
  return {
    snapshotId: snapshot.snapshotId,
    snapshotTimestamp: snapshot.snapshotTimestamp,
    libraryVersion,
    algorithm: HASH_ALGORITHM,
    entries,
  };
}

export function entryBySlug(manifest: SkillsManifest, slug: string): ManifestEntry {
  const entry = manifest.entries.find((item) => item.slug === slug);
  if (!entry) throw new Error(`No manifest entry for ${slug}`);
  return entry;
}
