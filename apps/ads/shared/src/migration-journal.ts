import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./migration-ledger";

export type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

export class MigrationJournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationJournalError";
  }
}

const TAG_NAME = /^[A-Za-z0-9_-]+$/;

type JournalFile = {
  entries?: Array<{ idx?: unknown; when?: unknown; tag?: unknown }>;
};

/**
 * Fail before Drizzle runs. `idx` and `when` must both strictly increase, and
 * every journal tag must be the SQL file of that name (and the reverse).
 * Drizzle applies a migration only when its `when` is greater than the latest
 * applied `created_at`, so an out-of-order stamp is a silent skip.
 */
export function assertMigrationJournal(migrationsFolder: string): JournalEntry[] {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  let parsed: JournalFile;
  try {
    parsed = JSON.parse(readFileSync(journalPath, "utf8")) as JournalFile;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new MigrationJournalError(`Migration journal could not be read (${journalPath}): ${detail}`);
  }
  if (!Array.isArray(parsed.entries)) {
    throw new MigrationJournalError(`${journalPath} has no entries`);
  }

  const entries: JournalEntry[] = [];
  let previousIdx = -1;
  let previousWhen = -1;
  const tags = new Set<string>();
  for (const raw of parsed.entries) {
    const tag = String(raw.tag ?? "");
    const idx = Number(raw.idx);
    const when = Number(raw.when);
    if (!TAG_NAME.test(tag)) {
      throw new MigrationJournalError(`Migration journal tag ${JSON.stringify(tag)} is not a file name.`);
    }
    if (tags.has(tag)) {
      throw new MigrationJournalError(`Migration journal tag ${tag} is duplicated.`);
    }
    tags.add(tag);
    if (!Number.isInteger(idx) || idx <= previousIdx) {
      throw new MigrationJournalError(
        `Migration journal idx must increase: ${tag} idx ${String(raw.idx)} is not after ${previousIdx}.`,
      );
    }
    if (!Number.isFinite(when) || when <= previousWhen) {
      throw new MigrationJournalError(
        `Migration journal when must increase: ${tag} (${String(raw.when)}) is not after ${previousWhen}.`,
      );
    }
    previousIdx = idx;
    previousWhen = when;
    entries.push({ idx, when, tag });
  }

  const sqlFiles = new Set(
    readdirSync(migrationsFolder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name.slice(0, -".sql".length)),
  );
  for (const entry of entries) {
    if (!sqlFiles.has(entry.tag)) {
      throw new MigrationJournalError(`Migration journal tag ${entry.tag} has no file ${entry.tag}.sql.`);
    }
  }
  for (const tag of sqlFiles) {
    if (!tags.has(tag)) {
      throw new MigrationJournalError(
        `Migration file ${tag}.sql is not in the journal. Rollback SQL belongs in apps/ads/shared/drizzle-rollbacks/, outside this folder.`,
      );
    }
  }
  return entries;
}

export function migrationSqlHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export type AppliedMigration = {
  hash: string | null;
  createdAt: number;
};

function journalHashes(migrationsFolder: string, entries: JournalEntry[]): Array<JournalEntry & { hash: string }> {
  return entries.map((entry) => ({
    ...entry,
    hash: migrationSqlHash(readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8")),
  }));
}

function foundHash(applied: AppliedMigration[], createdAt: number): string {
  const row = applied.find((candidate) => candidate.createdAt === createdAt);
  if (!row) return "<none>";
  return String(row.hash ?? "<null>");
}

/**
 * Before Drizzle migrate. Drizzle commits a migration newer than the latest
 * applied `created_at` and skips an older one. An older journal entry with no
 * ledger row has to fail first, or that newer migration is already committed.
 */
export function assertNoSkippedBeforeMigrate(
  migrationsFolder: string,
  entries: JournalEntry[],
  applied: AppliedMigration[],
): void {
  if (applied.length === 0) return;
  let maxCreated = Number.NEGATIVE_INFINITY;
  for (const row of applied) {
    if (Number.isFinite(row.createdAt) && row.createdAt > maxCreated) maxCreated = row.createdAt;
  }
  if (!Number.isFinite(maxCreated)) return;
  const problems: string[] = [];
  for (const entry of journalHashes(migrationsFolder, entries)) {
    if (entry.when > maxCreated) continue;
    const match = applied.some((row) => row.hash === entry.hash && row.createdAt === entry.when);
    if (!match) {
      problems.push(
        `Refusing to migrate. ${entry.tag} (when ${entry.when}) is at or below the latest applied created_at ${maxCreated} and has no matching row in ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}. Expected hash ${entry.hash}. Found hash ${foundHash(applied, entry.when)}.`,
      );
    }
  }
  if (problems.length > 0) throw new MigrationJournalError(problems.join(" "));
}

/**
 * After Drizzle migrate: every journal entry has a row with the same hash and
 * `created_at`, and every applied row belongs to the journal.
 */
export function assertMigrationsApplied(
  migrationsFolder: string,
  entries: JournalEntry[],
  applied: AppliedMigration[],
): void {
  const expected = journalHashes(migrationsFolder, entries);
  const problems: string[] = [];
  for (const entry of expected) {
    const match = applied.some((row) => row.hash === entry.hash && row.createdAt === entry.when);
    if (!match) {
      problems.push(
        `Unapplied or out-of-order migration ${entry.tag} (when ${entry.when}) has no matching row in ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}. Expected hash ${entry.hash}. Found hash ${foundHash(applied, entry.when)}.`,
      );
    }
  }
  for (const row of applied) {
    const match = expected.some((entry) => entry.hash === row.hash && entry.when === row.createdAt);
    if (!match) {
      problems.push(
        `Applied migration created_at ${row.createdAt} hash ${String(row.hash ?? "<null>").slice(0, 12)} is not in the journal.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new MigrationJournalError(problems.join(" "));
  }
}
