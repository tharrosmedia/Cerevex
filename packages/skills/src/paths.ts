import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Package root: packages/skills */
export const SKILLS_PACKAGE_ROOT = path.resolve(here, "..");

export const VENDOR_ROOT = path.join(SKILLS_PACKAGE_ROOT, "vendor");
export const REFERENCES_ROOT = path.join(VENDOR_ROOT, "tharros-shared-references");
export const REFERENCES_DIR = path.join(REFERENCES_ROOT, "references");
export const SKILLS_CONTENT_ROOT = path.join(VENDOR_ROOT, "skills");
export const GENERATED_DIR = path.join(SKILLS_PACKAGE_ROOT, "generated");
export const MANIFEST_PATH = path.join(GENERATED_DIR, "manifest.json");
export const CLIENT_CONFIG_PATH = path.join(GENERATED_DIR, "client-configs.json");
export const SNAPSHOT_PATH = path.join(VENDOR_ROOT, "SNAPSHOT.json");

export interface SnapshotRecord {
  snapshotId: string;
  snapshotTimestamp: string;
  timezone?: string;
  recordedFrom: string;
  sources: Array<{
    kind: string;
    archiveName: string;
    upstreamPath: string;
    vendoredPath: string;
    status: string;
    note?: string;
  }>;
}

export function readSnapshot(): SnapshotRecord {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SnapshotRecord;
}
