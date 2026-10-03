import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertProdTarget, ProdMigrateError, runOsProdMigrate } from "@tharros/ads-shared/prod-migrate";
import { assertSafeTestDatabase } from "@tharros/ads-shared/test-database";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const artifactsDir = resolve(repoRoot, "artifacts");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const cli = resolve(repoRoot, "apps/ads/shared/src/prod-migrate-cli.ts");
const createdDatabases: string[] = [];
const host = "127.0.0.1";

const journal = JSON.parse(readFileSync(join(artifactsDir, "os-migrate-bundle.json"), "utf8")) as {
  migrations: Array<{ tag: string; when: number; sha256: string }>;
};

function assertLocalDatabase(databaseUrl: string): void {
  assertSafeTestDatabase({
    databaseUrl,
    env: process.env,
    purpose: "prod migrate tests",
    write: (message) => {
      throw new Error(message);
    },
    exit: () => {
      throw new Error("refusing test database");
    },
  });
}

function databaseUrlFor(database: string): string {
  const raw = process.env.DATABASE_URL ?? "";
  assertLocalDatabase(raw);
  const scheme = raw.startsWith("postgresql:") ? "postgresql:" : "postgres:";
  const url = new URL(raw.replace(/^postgres(ql)?:/, "http:"));
  url.protocol = "http:";
  url.pathname = `/${database}`;
  const next = url.toString().replace(/^http:/, scheme);
  assertLocalDatabase(next);
  return next;
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL ?? "";
  assertLocalDatabase(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(name: string, template?: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("unsafe database name");
  if (template && !/^[a-z0-9_]+$/.test(template)) throw new Error("unsafe template name");
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    if (template) {
      await client.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    } else {
      await client.query(`CREATE DATABASE "${name}"`);
    }
  });
  createdDatabases.push(name);
  return databaseUrlFor(name);
}

function artifactSql(tag: string): string {
  return readFileSync(join(artifactsDir, `${tag}.sql`), "utf8");
}

function fileHash(tag: string): string {
  return createHash("sha256").update(artifactSql(tag)).digest("hex");
}

async function applyTags(client: pg.Client, tags: string[]): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS "os"');
  await client.query("SET search_path TO os, public");
  for (const tag of tags) {
    for (const statement of artifactSql(tag).split("--> statement-breakpoint")) {
      if (!statement.trim()) continue;
      await client.query(statement);
    }
  }
  await client.query(`CREATE TABLE IF NOT EXISTS "os"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  for (const tag of tags) {
    const entry = journal.migrations.find((migration) => migration.tag === tag);
    if (!entry) throw new Error(`missing ${tag}`);
    expect(fileHash(tag)).toBe(entry.sha256);
    await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
      entry.sha256,
      entry.when,
    ]);
  }
}

async function ledgerCount(databaseUrl: string): Promise<number> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`SELECT count(*)::int AS n FROM "os"."__drizzle_migrations"`);
    return Number(result.rows[0]?.n);
  } finally {
    await client.end();
  }
}

async function skillTable(databaseUrl: string): Promise<string | null> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`SELECT to_regclass('os.skill_client_configs') AS rel`);
    const rel = result.rows[0]?.rel;
    return rel ? String(rel) : null;
  } finally {
    await client.end();
  }
}

const baseName = `cerevex_prod_mig_${process.pid}_base`;
let baseReady: Promise<string> | undefined;

function baseDatabase(): Promise<string> {
  baseReady ??= (async () => {
    const databaseUrl = await createDatabase(baseName);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await applyTags(
        client,
        journal.migrations.slice(0, 5).map((migration) => migration.tag),
      );
    } finally {
      await client.end();
    }
    return databaseUrl;
  })();
  return baseReady;
}

async function cloneBase(suffix: string): Promise<string> {
  await baseDatabase();
  return createDatabase(`cerevex_prod_mig_${process.pid}_${suffix}`, baseName);
}

function request(databaseUrl: string, mode: "dry-run" | "apply" | "unconfirmed") {
  return runOsProdMigrate({
    databaseUrl,
    productionNeonHost: host,
    host,
    mode,
  });
}

afterAll(async () => {
  if (createdDatabases.length === 0) return;
  await withAdmin(async (client) => {
    for (const name of [...createdDatabases].reverse()) {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
});

describe("os production migrate", () => {
  beforeAll(async () => {
    await baseDatabase();
  }, 60_000);

  it("documents exactly one production command", () => {
    const readme = readFileSync(join(repoRoot, "apps/ads/README.md"), "utf8");
    const command = "npm run ads:db:migrate:prod -- --host <neon-host> --confirm";
    expect(readme.split(command)).toHaveLength(2);
    expect(readme).not.toContain("does not contain a production migrate command");
    const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(root.scripts["ads:db:migrate:prod"]).toBe("npm run migrate:prod --workspace=@tharros/ads-shared --");
  });

  it("refuses when PRODUCTION_NEON_HOST does not match the target", () => {
    expect(() =>
      assertProdTarget({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:5432/tharros",
        productionNeonHost: "ep-prod.region.aws.neon.tech",
        host: "127.0.0.1",
      }),
    ).toThrow(/PRODUCTION_NEON_HOST does not match the target/);
    expect(() =>
      assertProdTarget({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:5432/tharros",
        productionNeonHost: "ep-prod.region.aws.neon.tech",
        host: "ep-prod.region.aws.neon.tech",
      }),
    ).toThrow(/DATABASE_URL host does not match --host/);
  });

  it("refuses a sibling artifact whose hash does not match the bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "os-prod-migrate-"));
    const bundle = JSON.parse(readFileSync(join(artifactsDir, "os-migrate-bundle.json"), "utf8")) as {
      migrations: Array<{ filename: string; sql: string }>;
    };
    for (const migration of bundle.migrations) {
      writeFileSync(join(dir, migration.filename), readFileSync(join(artifactsDir, migration.filename)));
    }
    const last = bundle.migrations[bundle.migrations.length - 1]!;
    writeFileSync(join(dir, last.filename), `${readFileSync(join(dir, last.filename), "utf8")}\n-- tamper\n`);
    writeFileSync(join(dir, "os-migrate-bundle.json"), JSON.stringify(bundle));
    await expect(
      runOsProdMigrate({
        databaseUrl: "postgres://tharros:tharros@127.0.0.1:1/cerevex_prod_mig_absent",
        productionNeonHost: host,
        host,
        mode: "dry-run",
        artifactsDir: dir,
      }),
    ).rejects.toThrow(/Artifact hash for 0005_skill_config does not match the bundle/);
  });

  it("refuses to write without --confirm", async () => {
    const databaseUrl = await cloneBase("confirm");
    const before = await ledgerCount(databaseUrl);
    const error = await request(databaseUrl, "unconfirmed").then(
      () => {
        throw new Error("expected refusal");
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProdMigrateError);
    expect((error as Error).message).toContain("Pass --confirm");
    expect((error as ProdMigrateError).plan?.pending).toEqual(["0005_skill_config"]);
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await skillTable(databaseUrl)).toBeNull();
  });

  it("dry-run lists the pending tag and writes nothing", async () => {
    const databaseUrl = await cloneBase("dry");
    const before = await ledgerCount(databaseUrl);
    const report = await request(databaseUrl, "dry-run");
    expect(report.pending).toEqual(["0005_skill_config"]);
    expect(report.migrationsApplied).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await skillTable(databaseUrl)).toBeNull();
  });

  it("refuses ledger drift from an unknown row", async () => {
    const databaseUrl = await cloneBase("drift");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        "ab".repeat(32),
        1,
      ]);
    } finally {
      await client.end();
    }
    const before = await ledgerCount(databaseUrl);
    await expect(request(databaseUrl, "apply")).rejects.toThrow(/is not in the bundled artifacts/);
    expect(await ledgerCount(databaseUrl)).toBe(before);
    expect(await skillTable(databaseUrl)).toBeNull();
  });

  it("refuses a ledger hash that does not match the bundled artifact", async () => {
    const databaseUrl = await cloneBase("hash");
    const pending = journal.migrations[5]!;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`INSERT INTO "os"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        "ff".repeat(32),
        pending.when,
      ]);
    } finally {
      await client.end();
    }
    await expect(request(databaseUrl, "apply")).rejects.toThrow(
      /Ledger hash for 0005_skill_config .* does not match the bundled artifact/,
    );
    expect(await skillTable(databaseUrl)).toBeNull();
  });

  it("applies a pending migration once and is a no-op when it is already applied", async () => {
    const databaseUrl = await cloneBase("apply");
    const first = await request(databaseUrl, "apply");
    expect(first.migrationsApplied).toEqual(["0005_skill_config"]);
    expect(await skillTable(databaseUrl)).toContain("skill_client_configs");
    expect(await ledgerCount(databaseUrl)).toBe(journal.migrations.length);

    const second = await request(databaseUrl, "apply");
    expect(second.pending).toEqual([]);
    expect(second.migrationsApplied).toEqual([]);
    expect(await ledgerCount(databaseUrl)).toBe(journal.migrations.length);
  });

  it("the CLI refuses when PRODUCTION_NEON_HOST is missing", async () => {
    const env = { ...process.env };
    delete env.PRODUCTION_NEON_HOST;
    delete env.DATABASE_URL;
    const result = await new Promise<{ code: number; stdout: string }>((resolvePromise, reject) => {
      const child = spawn(tsxBin, [cli, "--host", host, "--confirm"], {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("prod migrate cli timed out"));
      }, 20_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolvePromise({ code: code ?? 1, stdout });
      });
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("DATABASE_URL is required");
    expect(result.stdout).not.toContain("postgres://");
  });
});
