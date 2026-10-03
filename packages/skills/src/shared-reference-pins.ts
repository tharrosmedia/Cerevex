import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SKILLS_PACKAGE_ROOT } from "./paths";

/** Live skills tree on the ops box. Re-sync reads this directory, not an old archive. */
export const DEFAULT_SKILLS_SOURCE = "/home/box/agent-data/workflows";

export const SHARED_REFERENCE_PINS_PATH = path.join(SKILLS_PACKAGE_ROOT, "pins", "shared-references.json");

/** Accepted shared-reference bytes. Re-sync checks these against the pin manifest before it copies. */
export const SHARED_REFERENCE_OVERLAY_ROOT = path.join(SKILLS_PACKAGE_ROOT, "overlays", "shared-references");

export interface SharedReferencePin {
  path: string;
  sha256: string;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function loadSharedReferencePins(filePath = SHARED_REFERENCE_PINS_PATH): SharedReferencePin[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { files?: SharedReferencePin[] };
  const files = parsed.files ?? [];
  if (files.length === 0) {
    throw new Error(`Shared reference pin manifest ${filePath} has no files.`);
  }
  for (const pin of files) {
    if (!pin.path || !/^[0-9a-f]{64}$/i.test(pin.sha256)) {
      throw new Error(`Shared reference pin manifest ${filePath} has an invalid entry for ${pin.path || "(missing path)"}.`);
    }
  }
  return files;
}

/**
 * Hash each pinned file under `root` and throw if any digest differs from the manifest.
 * A mismatch leaves the vendored tree untouched.
 */
export function verifySharedReferencePins(root: string, pins: SharedReferencePin[]): void {
  const mismatches: string[] = [];
  for (const pin of pins) {
    const filePath = path.join(root, pin.path);
    if (!existsSync(filePath)) {
      mismatches.push(`${pin.path} is missing (expected sha256 ${pin.sha256}).`);
      continue;
    }
    const actual = sha256File(filePath);
    if (actual !== pin.sha256.toLowerCase()) {
      mismatches.push(`${pin.path} sha256 mismatch. Expected ${pin.sha256}, got ${actual}.`);
    }
  }
  if (mismatches.length === 0) return;
  throw new Error(
    [
      "Pinned shared reference check failed.",
      ...mismatches,
      "Refusing to replace vendor/. The accepted files stay in place.",
    ].join("\n"),
  );
}
