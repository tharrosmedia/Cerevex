#!/usr/bin/env bun
/**
 * Repo-canonical OS Neon smoke migrator.
 * Reads apps/os/shared/drizzle (journal order). Does not seed.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runOsNeonMigrate } from "../artifacts/os-neon-migrate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../apps/os/shared/drizzle");
const journalPath = resolve(migrationsDir, "meta/_journal.json");

function redact(value: string): string {
  return value.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`]+/g, "[redacted-url]");
}

try {
  const summary = await runOsNeonMigrate({ migrationsDir, journalPath });
  console.log(JSON.stringify(summary));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    JSON.stringify({
      ok: false,
      error: redact(message),
      migrationsApplied: [],
      osTables: [],
      publicTableCount: 0,
      publicUnchanged: false,
    }),
  );
  process.exit(1);
}
