import { readFileSync } from "node:fs";
import path from "node:path";
import { buildManifest, entryBySlug, hashFiles } from "./manifest";
import { MANIFEST_PATH, REFERENCES_DIR, REFERENCES_ROOT, SKILLS_CONTENT_ROOT } from "./paths";
import { PROMPT_LAYER_SLUG, PROMPT_LAYER_VERSION } from "./prompt-layer";
import type { LoadedTemplate, ManifestEntry, SkillSlug, SkillsManifest } from "./types";
import { SKILL_SLUGS } from "./types";

export class SkillVersionPinError extends Error {
  constructor(slug: string, requested: string, pinned: string) {
    super(`Skill pin ${slug}@${pinned} does not match requested ${slug}@${requested}`);
    this.name = "SkillVersionPinError";
  }
}

function contentRoot(entry: ManifestEntry): string {
  if (entry.kind === "skill") return path.join(SKILLS_CONTENT_ROOT, entry.slug);
  if (entry.slug === "tharros-shared-references") return REFERENCES_ROOT;
  if (entry.slug.startsWith("verticals/")) {
    return path.join(REFERENCES_DIR, entry.slug);
  }
  if (entry.slug.startsWith("clients/")) {
    return path.join(REFERENCES_DIR, entry.slug);
  }
  if (entry.slug === "clients-roster") return path.join(REFERENCES_DIR, "clients");
  return REFERENCES_DIR;
}

function primaryBody(entry: ManifestEntry, root: string): string {
  if (entry.kind === "skill") return readFileSync(path.join(root, "SKILL.md"), "utf8");
  const md = entry.files.find((file) => file.path.endsWith(".md"));
  if (!md) throw new Error(`${entry.slug} has no markdown body`);
  return readFileSync(path.join(root, md.path), "utf8");
}

export function readCommittedManifest(): SkillsManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SkillsManifest;
}

function loadEntry(entry: ManifestEntry, requestedVersion: string): LoadedTemplate {
  if (entry.version !== requestedVersion) {
    throw new SkillVersionPinError(entry.slug, requestedVersion, entry.version);
  }
  const root = contentRoot(entry);
  const hashed = hashFiles(
    root,
    entry.files.map((file) => file.path),
  );
  if (hashed.contentHash !== entry.contentHash) {
    throw new Error(
      `Content hash for ${entry.slug}@${entry.version} does not match the manifest pin`,
    );
  }
  const body = primaryBody(entry, root);
  return {
    slug: entry.slug,
    kind: entry.kind,
    version: entry.version,
    contentHash: entry.contentHash,
    files: entry.files,
    body,
    read(relativePath: string): string {
      const normalized = relativePath.split("\\").join("/");
      if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
        throw new Error(`Refusing to read ${relativePath} outside ${entry.slug}`);
      }
      const known = entry.files.some((file) => file.path === normalized);
      if (!known) throw new Error(`${normalized} is not in the ${entry.slug}@${entry.version} pin`);
      return readFileSync(path.join(root, normalized), "utf8");
    },
  };
}

function manifestFromDisk(): SkillsManifest {
  return readCommittedManifest();
}

export function loadTemplate(slug: SkillSlug, version: string, manifest = manifestFromDisk()): LoadedTemplate {
  if (!(SKILL_SLUGS as readonly string[]).includes(slug)) {
    throw new Error(`${slug} is not a pinned slice 1 skill`);
  }
  return loadEntry(entryBySlug(manifest, slug), version);
}

export function loadSharedRef(slug: string, version: string, manifest = manifestFromDisk()): LoadedTemplate {
  const entry = entryBySlug(manifest, slug);
  if (entry.kind !== "shared-ref") throw new Error(`${slug} is a skill; use loadTemplate`);
  return loadEntry(entry, version);
}

/** Pinned prompt-layer procedure. Seeding a client layer is PR 3. */
export function loadPromptLayerRef(manifest = manifestFromDisk()): LoadedTemplate {
  return loadSharedRef(PROMPT_LAYER_SLUG, PROMPT_LAYER_VERSION, manifest);
}

export function listPins(manifest = manifestFromDisk()): ManifestEntry[] {
  return manifest.entries;
}
