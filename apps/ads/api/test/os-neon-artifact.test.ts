import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "@tharros/ads-shared/migration-ledger";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const artifactsDir = resolve(repoRoot, "artifacts");
const artifactPath = join(artifactsDir, "os-neon-migrate.ts");
const sourceDir = resolve(repoRoot, "apps/ads/shared/drizzle");

type JournalEntry = { idx: number; when: number; tag: string };
type BundleMigration = { filename: string; tag: string; idx: number; when: number; sha256: string; sql: string };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function importSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) specs.add(match[1]!);
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) specs.add(match[1]!);
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.add(match[1]!);
  return [...specs];
}

function specifierStaysInArtifacts(spec: string, fromFile: string): boolean {
  if (spec.startsWith("node:") || spec.startsWith("bun:")) return true;
  if (!spec.startsWith(".")) return false;
  const resolved = normalize(resolve(dirname(fromFile), spec));
  return resolved === artifactsDir || resolved.startsWith(`${artifactsDir}/`);
}

describe("os neon artifact bundle", () => {
  it("inlines the ledger constants and imports no packages", async () => {
    const source = readFileSync(artifactPath, "utf8");
    expect(source).toContain(`const MIGRATIONS_SCHEMA = ${JSON.stringify(MIGRATIONS_SCHEMA)}`);
    expect(source).toContain(`const MIGRATIONS_TABLE = ${JSON.stringify(MIGRATIONS_TABLE)}`);
    expect(MIGRATIONS_SCHEMA).toBe("os");
    expect(MIGRATIONS_TABLE).toBe("__drizzle_migrations");

    const tsFiles = readdirSync(artifactsDir).filter((name) => name.endsWith(".ts"));
    expect(tsFiles).toContain("os-neon-migrate.ts");
    for (const name of tsFiles) {
      const file = join(artifactsDir, name);
      const specs = importSpecifiers(readFileSync(file, "utf8"));
      for (const spec of specs) {
        expect(specifierStaysInArtifacts(spec, file), `${name} imports ${spec}`).toBe(true);
      }
    }

    const artifact = (await import(pathToFileURL(artifactPath).href)) as {
      MIGRATIONS_SCHEMA: string;
      MIGRATIONS_TABLE: string;
      loadOsMigrations: () => Array<{ tag: string; when: number; sql: string }>;
    };
    expect(artifact.MIGRATIONS_SCHEMA).toBe(MIGRATIONS_SCHEMA);
    expect(artifact.MIGRATIONS_TABLE).toBe(MIGRATIONS_TABLE);

    const journal = JSON.parse(readFileSync(join(sourceDir, "meta/_journal.json"), "utf8")) as {
      entries: JournalEntry[];
    };
    const bundle = JSON.parse(readFileSync(join(artifactsDir, "os-migrate-bundle.json"), "utf8")) as {
      migrations: BundleMigration[];
    };
    expect(bundle.migrations.map((entry) => entry.tag)).toEqual(journal.entries.map((entry) => entry.tag));
    for (const [index, entry] of journal.entries.entries()) {
      const bundled = bundle.migrations[index]!;
      const filename = `${entry.tag}.sql`;
      const sourceSql = readFileSync(join(sourceDir, filename), "utf8");
      const siblingSql = readFileSync(join(artifactsDir, filename), "utf8");
      expect(bundled.filename).toBe(filename);
      expect(bundled.idx).toBe(entry.idx);
      expect(bundled.when).toBe(entry.when);
      expect(bundled.sql).toBe(sourceSql);
      expect(siblingSql).toBe(sourceSql);
      expect(bundled.sha256).toBe(sha256(sourceSql));
    }

    const loaded = artifact.loadOsMigrations();
    expect(loaded.map((entry) => entry.tag)).toEqual(journal.entries.map((entry) => entry.tag));
    for (const [index, entry] of journal.entries.entries()) {
      const sourceSql = readFileSync(join(sourceDir, `${entry.tag}.sql`), "utf8");
      expect(loaded[index]!.when).toBe(entry.when);
      expect(sha256(loaded[index]!.sql)).toBe(sha256(sourceSql));
    }
  });
});
