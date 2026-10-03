import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parse as parseConnectionString, type ConnectionOptions } from "pg-connection-string";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./migration-ledger";

const here = dirname(fileURLToPath(import.meta.url));
const defaultArtifactsDir = resolve(here, "../../../../artifacts");
const TAG_NAME = /^[A-Za-z0-9_-]+$/;
/**
 * Advisory lock owned by this production migrate command.
 * The key is hashtext of this name, cast to bigint. It is not a shared app lock.
 */
export const PROD_MIGRATE_LOCK_NAME = "cerevex.os-prod-migrate";
/** Wait for another run of this command. Distinct from the DDL lock timeout. */
const ADVISORY_LOCK_WAIT = "30s";
const DDL_LOCK_TIMEOUT = "5s";
export const DEFAULT_STATEMENT_TIMEOUT = "120s";
const STATEMENT_TIMEOUT = /^[1-9]\d*(?:ms|s|min)$/;
const STRICT_SSLMODE = new Set(["require", "verify-ca", "verify-full"]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const INSECURE_LOOPBACK_FLAG = "OS_PROD_MIGRATE_ALLOW_INSECURE_LOOPBACK";

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
  /** Validated duration such as 120s. Defaults to 120s. */
  statementTimeout?: string;
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

function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host.startsWith("/")) host = host.replace(/\.+$/, "");
  return host;
}

function queryParamNames(value: string): Set<string> {
  try {
    const url = new URL(value);
    return new Set([...url.searchParams.keys()].map((key) => key.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Host pg will open, using the same parser as node-postgres. Query overrides
 * that can steer the session somewhere else are refused before any connection.
 */
export function connectionHost(databaseUrl: string, label = "DATABASE_URL"): string {
  const trimmed = databaseUrl.trim();
  if (!trimmed) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is empty.`);
  }
  let config: ConnectionOptions;
  try {
    config = parseConnectionString(trimmed, { useLibpqCompat: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/sslmode=verify-ca/i.test(message)) {
      throw new ProdMigrateError("Refusing to migrate. sslmode=verify-ca requires sslrootcert.");
    }
    throw new ProdMigrateError(`Refusing to migrate. ${label} could not be parsed.`);
  }

  const params = queryParamNames(trimmed);
  if (params.has("host")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} must not set the host query parameter.`);
  }
  if (params.has("hostaddr") || (config.hostaddr != null && String(config.hostaddr) !== "")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} must not set hostaddr.`);
  }
  if (params.has("options") || (typeof config.options === "string" && config.options.trim() !== "")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} must not set options.`);
  }

  const hostField = typeof config.host === "string" ? config.host : "";
  if (!hostField) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} has no host.`);
  }
  if (hostField.startsWith("/") || hostField.includes(",")) {
    if (hostField.startsWith("/")) {
      throw new ProdMigrateError(`Refusing to migrate. ${label} must not use a unix socket host.`);
    }
    throw new ProdMigrateError(`Refusing to migrate. ${label} must name exactly one host.`);
  }
  const host = normalizeHost(hostField);
  if (!host || host.startsWith("/")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} must not use a unix socket host.`);
  }

  const password = typeof config.password === "string" ? config.password : "";
  if (/endpoint=/i.test(password)) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} password must not contain endpoint=.`);
  }

  const sslmode = typeof config.sslmode === "string" ? config.sslmode.toLowerCase() : "";
  if (sslmode === "disable") {
    throw new ProdMigrateError("Refusing to migrate. sslmode=disable is not allowed.");
  }
  const strictSsl = STRICT_SSLMODE.has(sslmode);
  const loopbackTest =
    LOCAL_HOSTS.has(host) && process.env[INSECURE_LOOPBACK_FLAG] === "1" && sslmode === "";
  if (!strictSsl && !loopbackTest) {
    throw new ProdMigrateError("Refusing to migrate. DATABASE_URL must set sslmode=require or stricter.");
  }
  return host;
}

function namedHost(token: string, label: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is empty.`);
  }
  if (/^(?:postgres|postgresql):\/\//i.test(trimmed)) {
    return connectionHost(trimmed, label);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const host = normalizeHost(new URL(trimmed).hostname);
      if (!host || host.startsWith("/") || host.includes(",")) {
        throw new Error("empty");
      }
      return host;
    } catch {
      throw new ProdMigrateError(`Refusing to migrate. ${label} is not a hostname.`);
    }
  }
  if (/[\s/?#]/.test(trimmed) || trimmed.includes("://")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is not a hostname.`);
  }
  const bare = trimmed.replace(/:\d+$/, "");
  const host = normalizeHost(bare);
  if (host === "::1") return host;
  if (!host || host.includes(",") || host.startsWith("/") || host.includes(":")) {
    throw new ProdMigrateError(`Refusing to migrate. ${label} is not a hostname.`);
  }
  return host;
}

/**
 * The host node-postgres would connect to, `--host`, and PRODUCTION_NEON_HOST
 * must be the same hostname. Checked before any connection.
 */
export function assertProdTarget(input: {
  databaseUrl: string;
  productionNeonHost: string;
  host: string;
}): string {
  const named = namedHost(input.host, "--host");
  const target = connectionHost(input.databaseUrl, "DATABASE_URL");
  const listed = namedHost(input.productionNeonHost, "PRODUCTION_NEON_HOST");
  if (target !== named) {
    throw new ProdMigrateError("Refusing to migrate. DATABASE_URL host does not match --host.");
  }
  if (listed !== named) {
    throw new ProdMigrateError("Refusing to migrate. PRODUCTION_NEON_HOST does not match the target.");
  }
  return named;
}

export function parseProdMigrateArgs(argv: string[]): {
  host: string;
  mode: ProdMigrateMode;
  statementTimeout: string;
} {
  let host: string | undefined;
  let dryRun = false;
  let confirm = false;
  let statementTimeout = DEFAULT_STATEMENT_TIMEOUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      host = argv[index + 1];
      index += 1;
      if (!host || host.startsWith("--")) {
        throw new ProdMigrateError("Refusing to migrate. Name the prod host with --host <hostname>.");
      }
      continue;
    }
    if (arg === "--statement-timeout") {
      const value = argv[index + 1];
      index += 1;
      if (!value || value.startsWith("--")) {
        throw new ProdMigrateError("Refusing to migrate. --statement-timeout needs a duration such as 120s.");
      }
      statementTimeout = parseStatementTimeout(value);
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--confirm") {
      confirm = true;
      continue;
    }
    throw new ProdMigrateError(`Refusing to migrate. Unknown argument ${JSON.stringify(arg ?? "")}.`);
  }
  if (!host) {
    throw new ProdMigrateError("Refusing to migrate. Name the prod host with --host <hostname>.");
  }
  if (dryRun && confirm) {
    throw new ProdMigrateError("Refusing to migrate. Pass only one of --dry-run or --confirm.");
  }
  if (dryRun) return { host, mode: "dry-run", statementTimeout };
  if (confirm) return { host, mode: "apply", statementTimeout };
  return { host, mode: "unconfirmed", statementTimeout };
}

function parseStatementTimeout(value: string): string {
  const timeout = value.trim();
  if (!STATEMENT_TIMEOUT.test(timeout)) {
    throw new ProdMigrateError("Refusing to migrate. --statement-timeout must be a duration such as 120s.");
  }
  return timeout;
}

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Comments and string literals removed, so a mention of public. in either does not count. */
export function sqlOutsideCommentsAndLiterals(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      out += " ";
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (sql[index] === "$") {
      const match = /^\$([A-Za-z0-9_]*)\$/.exec(sql.slice(index));
      if (match) {
        const closer = match[0];
        const end = sql.indexOf(closer, index + closer.length);
        index = end === -1 ? sql.length : end + closer.length;
        out += "''";
        continue;
      }
    }
    if (sql[index] === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      out += "''";
      continue;
    }
    out += sql[index];
    index += 1;
  }
  return out;
}

function searchPathIsOsOnly(target: string): boolean {
  const parts = target
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, "").toLowerCase())
    .filter((part) => part.length > 0);
  return parts.length === 1 && parts[0] === "os";
}

export function assertOsOnly(sql: string, tag: string): void {
  const visible = sqlOutsideCommentsAndLiterals(sql);
  if (/"public"\s*\./i.test(visible) || /\bpublic\s*\./i.test(visible)) {
    throw new ProdMigrateError(`Refusing to migrate. ${tag} targets the public schema.`);
  }
  if (/\bset\s+schema\s+(?:"public"|public)\b/i.test(visible)) {
    throw new ProdMigrateError(`Refusing to migrate. ${tag} sets the schema to public.`);
  }
  const searchPath = /\bset\s+(?:local\s+|session\s+)?search_path\s*(?:=|to)\s*([^;]+)/gi;
  for (const match of visible.matchAll(searchPath)) {
    if (!searchPathIsOsOnly(match[1] ?? "")) {
      throw new ProdMigrateError(`Refusing to migrate. ${tag} sets search_path to something other than os.`);
    }
  }
  if (!/"os"\s*\./i.test(visible) && !/\bos\s*\./i.test(visible)) {
    throw new ProdMigrateError(`Refusing to migrate. ${tag} is not schema-qualified to os.`);
  }
}

function isLockTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && (current as { code: unknown }).code === "55P03") return true;
    current = "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /lock timeout/i.test(message);
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
    assertOsOnly(sql, tag);
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
    const mode = await client.query(`SELECT current_setting('transaction_read_only') AS ro`);
    if (String(mode.rows[0]?.ro) !== "on") {
      throw new ProdMigrateError("Refusing to migrate. Ledger listing must be a read-only transaction.");
    }
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

    const statementTimeout = parseStatementTimeout(request.statementTimeout ?? DEFAULT_STATEMENT_TIMEOUT);
    let reportPlan = plan;
    const migrationsApplied: string[] = [];
    for (const migration of bundled.filter((entry) => plan.pending.includes(entry.tag))) {
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL lock_timeout = '${ADVISORY_LOCK_WAIT}'`);
        try {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [PROD_MIGRATE_LOCK_NAME]);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          if (isLockTimeout(error)) {
            throw new ProdMigrateError("Refusing to migrate. Another migrate run holds the lock.", reportPlan);
          }
          throw error;
        }
        await client.query(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
        await client.query(`SET LOCAL statement_timeout = '${statementTimeout}'`);
        await client.query(`SET LOCAL search_path TO ${MIGRATIONS_SCHEMA}, public`);
        const lockedRows = await client.query(
          `SELECT hash, created_at FROM ${ledgerRelation()} ORDER BY id`,
        );
        const lockedPlan = planFromLedger(host, bundled, lockedRows.rows as LedgerRow[]);
        if (lockedPlan.problems.length > 0) {
          await client.query("ROLLBACK");
          throw new ProdMigrateError(`Refusing to migrate. ${lockedPlan.problems.join(" ")}`, lockedPlan);
        }
        if (!lockedPlan.pending.includes(migration.tag)) {
          await client.query("ROLLBACK");
          reportPlan = lockedPlan;
          continue;
        }
        for (const statement of splitStatements(migration.sql)) {
          await client.query(statement);
        }
        await client.query(`INSERT INTO ${ledgerRelation()} (hash, created_at) VALUES ($1, $2)`, [
          migration.sha256,
          migration.when,
        ]);
        await client.query("COMMIT");
        migrationsApplied.push(migration.tag);
        reportPlan = {
          ...lockedPlan,
          applied: [...lockedPlan.applied, migration.tag],
          pending: lockedPlan.pending.filter((tag) => tag !== migration.tag),
        };
      } catch (error) {
        if (error instanceof ProdMigrateError) throw error;
        await client.query("ROLLBACK").catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new ProdMigrateError(
          `Refusing to migrate. ${migration.tag} rolled back in its transaction. ${redactDatabaseUrl(message, request.databaseUrl)}`,
          { ...reportPlan, pending: reportPlan.pending.slice(migrationsApplied.length) },
        );
      }
    }

    return { ...reportPlan, ok: true, migrationsApplied };
  } finally {
    await client.end();
  }
}
