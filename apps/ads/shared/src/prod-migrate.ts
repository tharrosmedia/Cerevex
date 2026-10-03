import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./migration-ledger";

const here = dirname(fileURLToPath(import.meta.url));
const defaultArtifactsDir = resolve(here, "../../../../artifacts");
const TAG_NAME = /^[A-Za-z0-9_-]+$/;

export class ProdMigrateError extends Error {
  readonly plan: ProdMigratePlan | null;

  constructor(message: string, plan: ProdMigratePlan | null = null) {
    super(message);
    this.name = "ProdMigrateError";
    this.plan = plan;
  }
}

export type ProdMigrateMode = "dry-run" | "apply" | "unconfirmed";

export type BundledMigration = {
  tag: string;
  filename: string;
  idx: number;
  when: number;
  sha256: string;
  sql: string;
};

export type ProdMigratePlan = {
  host: string;
  applied: string[];
  pending: string[];
  problems: string[];
};

export type ProdMigrateReport = ProdMigratePlan & {
  ok: true;
  migrationsApplied: string[];
};

export type ProdMigrateRequest = {
  databaseUrl: string;
  productionNeonHost: string;
  host: string;
  mode: ProdMigrateMode;
  artifactsDir?: string;
};

type BundleFile = {
  migrations?: Array<{
    filename?: unknown;
    tag?: unknown;
    idx?: unknown;
    when?: unknown;
    sha256?: unknown;
    sql?: unknown;
  }>;
};

type LedgerRow = { hash: string; created_at: string | number | bigint };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function redactDatabaseUrl(value: string, databaseUrl?: string): string {
  let next = value.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`]+/g, "[redacted-url]");
  if (databaseUrl && databaseUrl.length > 0 && next.includes(databaseUrl)) {
    next = next.split(databaseUrl).join("[DATABASE_URL]");
  }
  return next;
}

function hostnameFromUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new ProdMigrateError("Refusing to migrate. DATABASE_URL could not be parsed.");
  }
  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (!host) {
    throw new ProdMigrateError("Refusing to migrate. DATABASE_URL has no host.");
  }
  return host;
}

function hostnameFromToken(token: string, label: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is empty.`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return hostnameFromUrl(trimmed.replace(/^postgres(ql)?:/i, "http:"));
  }
  if (/[\s/]/.test(trimmed)) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is not a hostname.`);
  }
  const bare = trimmed.replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase();
  if (!bare || bare.includes(":")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is not a hostname.`);
  }
  return bare;
}

/**
 * The named `--host`, the DATABASE_URL host, and PRODUCTION_NEON_HOST must be
 * the same hostname. Checked before any connection.
 */
export function assertProdTarget(input: {
  databaseUrl: string;
  productionNeonHost: string;
  host: string;
}): string {
  const named = hostnameFromToken(input.host, "--host");
  const target = hostnameFromUrl(input.databaseUrl);
  const listed = hostnameFromToken(input.productionNeonHost, "PRODUCTION_NEON_HOST");
  if (target !== named) {
    throw new ProdMigrateError("Refusing to migrate. DATABASE_URL host does not match --host.");
  }
  if (listed !== named) {
    throw new ProdMigrateError("Refusing to migrate. PRODUCTION_NEON_HOST does not match the target.");
  }
  return named;
}

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function loadBundledMigrations(artifactsDir = defaultArtifactsDir): BundledMigration[] {
  const bundlePath = join(artifactsDir, "os-migrate-bundle.json");
  let parsed: BundleFile;
  try {
    parsed = JSON.parse(readFileSync(bundlePath, "utf8")) as BundleFile;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProdMigrateError(`Refusing to migrate. Bundle could not be read (${bundlePath}): ${detail}`);
  }
  if (!Array.isArray(parsed.migrations) || parsed.migrations.length === 0) {
    throw new ProdMigrateError("Refusing to migrate. Bundle has no migrations.");
  }

  const migrations: BundledMigration[] = [];
  let previousIdx = -1;
  let previousWhen = -1;
  const tags = new Set<string>();
  for (const raw of parsed.migrations) {
    const tag = String(raw.tag ?? "");
    const filename = String(raw.filename ?? "");
    const idx = Number(raw.idx);
    const when = Number(raw.when);
    const recorded = String(raw.sha256 ?? "");
    if (!TAG_NAME.test(tag) || filename !== `${tag}.sql`) {
      throw new ProdMigrateError(`Refusing to migrate. Bundle tag ${JSON.stringify(tag)} is not a sibling SQL file.`);
    }
    if (tags.has(tag)) {
      throw new ProdMigrateError(`Refusing to migrate. Bundle tag ${tag} is duplicated.`);
    }
    tags.add(tag);
    if (!Number.isInteger(idx) || idx <= previousIdx || !Number.isFinite(when) || when <= previousWhen) {
      throw new ProdMigrateError(`Refusing to migrate. Bundle entry ${tag} is out of order.`);
    }
    previousIdx = idx;
    previousWhen = when;
    const sql = readFileSync(join(artifactsDir, filename), "utf8");
    const digest = sha256(sql);
    if (digest !== recorded || sha256(String(raw.sql ?? "")) !== digest) {
      throw new ProdMigrateError(
        `Refusing to migrate. Artifact hash for ${tag} does not match the bundle. Expected ${recorded} found ${digest}.`,
      );
    }
    migrations.push({ tag, filename, idx, when, sha256: digest, sql });
  }
  return migrations;
}

function planFromLedger(host: string, bundled: BundledMigration[], rows: LedgerRow[]): ProdMigratePlan {
  const problems: string[] = [];
  const matched = new Map<string, number>();

  for (const row of rows) {
    const createdAt = Number(row.created_at);
    const hash = String(row.hash ?? "");
    const byWhen = bundled.find((migration) => migration.when === createdAt);
    const byHash = bundled.find((migration) => migration.sha256 === hash);
    if (byWhen && byWhen.sha256 === hash) {
      matched.set(byWhen.tag, (matched.get(byWhen.tag) ?? 0) + 1);
      continue;
    }
    if (byWhen) {
      problems.push(
        `Ledger hash for ${byWhen.tag} (created_at ${createdAt}) does not match the bundled artifact. Expected ${byWhen.sha256} found ${hash}.`,
      );
      continue;
    }
    if (byHash) {
      problems.push(
        `Ledger drift: hash of ${byHash.tag} is recorded at created_at ${String(row.created_at)}, bundled when is ${byHash.when}.`,
      );
      continue;
    }
    problems.push(
      `Ledger row created_at ${String(row.created_at)} hash ${hash.slice(0, 12)} is not in the bundled artifacts.`,
    );
  }

  for (const [tag, count] of matched) {
    if (count !== 1) {
      problems.push(`Ledger drift: ${tag} is recorded ${count} times.`);
    }
  }

  let missing = "";
  for (const migration of bundled) {
    const applied = matched.get(migration.tag) === 1;
    if (!applied) {
      if (!missing) missing = migration.tag;
      continue;
    }
    if (missing) {
      problems.push(`Ledger drift: ${migration.tag} is applied but earlier bundled migration ${missing} is not.`);
    }
  }

  const applied = bundled.filter((migration) => matched.get(migration.tag) === 1).map((migration) => migration.tag);
  const pending =
    problems.length === 0
      ? bundled.filter((migration) => matched.get(migration.tag) !== 1).map((migration) => migration.tag)
      : [];
  return { host, applied, pending, problems };
}

function ledgerRelation(): string {
  return `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;
}

async function readLedger(client: pg.Client): Promise<LedgerRow[]> {
  await client.query("BEGIN READ ONLY");
  try {
    const exists = await client.query(`SELECT to_regclass($1::text) AS rel`, [
      `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
    ]);
    const rel = exists.rows[0]?.rel;
    if (!rel) {
      await client.query("COMMIT");
      throw new ProdMigrateError(
        `Refusing to migrate. ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} does not exist. This command does not create it.`,
      );
    }
    const selected = await client.query(
      `SELECT hash, created_at FROM ${ledgerRelation()} ORDER BY id`,
    );
    await client.query("COMMIT");
    return selected.rows as LedgerRow[];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/**
 * Read-only ledger listing, then apply pending bundled migrations only when
 * `--confirm` is set and the ledger matches the artifacts. Each migration
 * commits its SQL and its ledger row in one transaction.
 */
export async function runOsProdMigrate(request: ProdMigrateRequest): Promise<ProdMigrateReport> {
  const host = assertProdTarget(request);
  const bundled = loadBundledMigrations(request.artifactsDir);
  const client = new pg.Client({ connectionString: request.databaseUrl });
  await client.connect();
  try {
    let rows: LedgerRow[];
    try {
      rows = await readLedger(client);
    } catch (error) {
      if (error instanceof ProdMigrateError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ProdMigrateError(redactDatabaseUrl(message, request.databaseUrl));
    }

    const plan = planFromLedger(host, bundled, rows);
    if (plan.problems.length > 0) {
      throw new ProdMigrateError(`Refusing to migrate. ${plan.problems.join(" ")}`, plan);
    }
    if (request.mode === "dry-run") {
      return { ...plan, ok: true, migrationsApplied: [] };
    }
    if (request.mode === "unconfirmed") {
      throw new ProdMigrateError(
        "Refusing to migrate. Pass --confirm to apply the pending migrations. --dry-run prints this listing and writes nothing.",
        plan,
      );
    }

    const pending = bundled.filter((migration) => plan.pending.includes(migration.tag));
    const migrationsApplied: string[] = [];
    for (const migration of pending) {
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO ${MIGRATIONS_SCHEMA}, public`);
        for (const statement of splitStatements(migration.sql)) {
          await client.query(statement);
        }
        await client.query(`INSERT INTO ${ledgerRelation()} (hash, created_at) VALUES ($1, $2)`, [
          migration.sha256,
          migration.when,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new ProdMigrateError(
          `Refusing to migrate. ${migration.tag} rolled back in its transaction. ${redactDatabaseUrl(message, request.databaseUrl)}`,
          { ...plan, pending: plan.pending.slice(migrationsApplied.length) },
        );
      }
      migrationsApplied.push(migration.tag);
    }

    return { ...plan, ok: true, migrationsApplied };
  } finally {
    await client.end();
  }
}
