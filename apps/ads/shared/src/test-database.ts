/**
 * Hard guard for test entrypoints and seed scripts that open a real database.
 *
 * The host that matters is the one node-postgres would connect to.
 * `pg` parses `DATABASE_URL` with `pg-connection-string`, and a `?host=`
 * query parameter replaces the URI hostname. Comma-separated host lists are
 * checked one by one. `hostaddr` is not a connection target in this driver.
 *
 * Allowed when every resolved host is:
 * - localhost, 127.0.0.1, ::1, or a unix socket path
 * - a known test database (name exactly `test`, or ending in the `_test` /
 *   `-test` token, or a host label `test` / `ci`)
 * - a Neon branch database (`*.neon.tech` with an anchored branch marker)
 * - any other host when ALLOW_NONLOCAL_TEST_DB=1
 *
 * Production Neon host:
 * The production compute hostname is not committed, and Railway variable values
 * are not readable, so it is not hardcoded. Neon branch computes use the same
 * `ep-<id>[-pooler].<region>.aws.neon.tech` shape as the default branch, so a
 * hostname regex cannot tell them apart. If PRODUCTION_NEON_HOST or
 * PRODUCTION_DATABASE_URL is present in the environment, that host (and the
 * matching Neon pooler/direct twin) is refused even when the opt-in is set.
 * PRODUCTION_NEON_HOST may be a bare host, host:port, or any scheme URL
 * (`postgres://`, `https://`, and so on); the hostname is what is denied.
 * Empty or whitespace-only values of either variable are unset. A non-empty
 * value that does not parse fails closed.
 *
 * A `branch` query parameter does not mark a Neon branch. Host and database
 * markers still can, but never for a host that matches the production list.
 *
 * Wired from:
 * - apps/ads/shared/src/seed.ts
 * - apps/ads/api/test/setup-database-guard.ts (vitest setup for every ads API test)
 *
 * No other apps/ or packages/ test entrypoint or seed script opens a real
 * database. Brain tests are in-memory. packages/db and packages/shared have no
 * runners. Migrate scripts are intentional ops paths and are not guarded.
 */

import { parse as parseConnectionString, type ConnectionOptions } from "pg-connection-string";

export const TEST_DATABASE_OPT_IN_ENV = "ALLOW_NONLOCAL_TEST_DB";
export const PRODUCTION_NEON_HOST_ENV = "PRODUCTION_NEON_HOST";
export const PRODUCTION_DATABASE_URL_ENV = "PRODUCTION_DATABASE_URL";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Exactly `test`, or a name whose final token is `_test` / `-test`. */
const TEST_DATABASE_NAME = /^(?:test|.+[_-]test)$/i;

/** A Neon branch id, not a substring inside a larger token. */
const BRANCH_ID = /^br-[a-z0-9_-]+$/i;

const BRANCH_TOKEN = /(?:^|[_-])branch(?:[_-]|$)/i;

export type TestDatabaseVerdict = {
  allowed: boolean;
  host: string | null;
  message: string;
};

export type EnvLike = Record<string, string | undefined>;

export type AssessTestDatabaseInput = {
  databaseUrl?: string;
  env?: EnvLike;
  requireUrl?: boolean;
  purpose?: string;
};

type ParsedConnection = {
  hosts: string[];
  database: string;
};

type ProductionHosts = { ok: true; hosts: string[] } | { ok: false; detail: string };

function purposeLabel(purpose: string | undefined): string {
  return purpose?.trim() || "this database command";
}

function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
}

function isAbsoluteConnectionString(value: string): boolean {
  return /^(?:postgres|postgresql):\/\//i.test(value) || value.startsWith("/");
}

function blankEnv(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

const HOSTNAME = /^(?:[a-z0-9_-]|\.)+$/i;
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

function connectionHosts(hostField: string): string[] {
  return hostField
    .split(",")
    .map((part) => normalizeHost(part))
    .filter((part) => part.length > 0);
}

/**
 * Parse with the same library node-postgres uses. Returns null when the
 * string is not a postgres URL or socket path, or when the parser throws.
 * Relative garbage is not treated as a successful parse: the library would
 * otherwise resolve it against an internal `postgres://base` placeholder.
 */
function parseDriverConnection(raw: string): ParsedConnection | null {
  const trimmed = raw.trim();
  if (!trimmed || !isAbsoluteConnectionString(trimmed)) return null;
  let config: ConnectionOptions;
  try {
    config = parseConnectionString(trimmed);
  } catch {
    return null;
  }
  const hostField = typeof config.host === "string" ? config.host : "";
  const database = typeof config.database === "string" ? config.database.toLowerCase() : "";
  return { hosts: connectionHosts(hostField), database };
}

function isTestDatabaseName(name: string): boolean {
  return TEST_DATABASE_NAME.test(name);
}

export function isLocalDatabaseHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host.startsWith("/")) return true;
  return LOCAL_HOSTS.has(host);
}

function isKnownTestDatabase(database: string, host: string): boolean {
  if (isTestDatabaseName(database)) return true;
  return host.split(".").some((label) => label === "test" || label === "ci");
}

function isNeonHost(host: string): boolean {
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

function hasAnchoredBranchMarker(parsed: ParsedConnection, host: string): boolean {
  if (BRANCH_ID.test(parsed.database) || parsed.database === "preview" || BRANCH_TOKEN.test(parsed.database)) {
    return true;
  }
  const labels = host.split(".");
  if (labels.some((label) => BRANCH_ID.test(label))) return true;
  const endpoint = labels[0] ?? "";
  return endpoint.split("-").includes("branch");
}

function isNeonBranchDatabase(parsed: ParsedConnection, host: string, productionHosts: string[]): boolean {
  if (!isNeonHost(host) || matchesProductionHost(host, productionHosts)) return false;
  return hasAnchoredBranchMarker(parsed, host);
}

function neonEndpointKey(host: string): string | null {
  if (!isNeonHost(host)) return null;
  const first = host.split(".")[0] ?? "";
  if (!first.startsWith("ep-")) return null;
  return first.replace(/-pooler$/, "");
}

/**
 * PRODUCTION_NEON_HOST token: bare hostname, host:port, or any scheme URL.
 * Returns [] for a blank token, null when a non-empty token has no hostname.
 */
function hostsFromToken(token: string): string[] | null {
  const trimmed = token.trim();
  if (!trimmed) return [];
  if (SCHEME_URL.test(trimmed)) {
    try {
      const host = normalizeHost(new URL(trimmed).hostname);
      return host ? [host] : null;
    } catch {
      return null;
    }
  }
  if (/[\s/]/.test(trimmed) || trimmed.includes("://")) return null;
  const portMatch = /^(.*):(\d+)$/.exec(trimmed);
  const bare = portMatch ? portMatch[1] : trimmed;
  if (!bare || !HOSTNAME.test(bare)) return null;
  const host = normalizeHost(bare);
  return host ? [host] : null;
}

function hostsFromListedValue(value: string): string[] | null {
  const hosts: string[] = [];
  for (const part of value.split(",")) {
    const parsed = hostsFromToken(part);
    if (!parsed) return null;
    hosts.push(...parsed);
  }
  return hosts.length > 0 ? hosts : null;
}

function loadProductionHosts(env: EnvLike): ProductionHosts {
  const hosts: string[] = [];
  const listed = env[PRODUCTION_NEON_HOST_ENV];
  if (!blankEnv(listed)) {
    const parsed = hostsFromListedValue(listed ?? "");
    if (!parsed) {
      return { ok: false, detail: `${PRODUCTION_NEON_HOST_ENV} is set but could not be parsed.` };
    }
    hosts.push(...parsed);
  }
  const databaseUrl = env[PRODUCTION_DATABASE_URL_ENV];
  if (!blankEnv(databaseUrl)) {
    const parsed = parseDriverConnection(databaseUrl ?? "");
    if (!parsed || parsed.hosts.length === 0) {
      return { ok: false, detail: `${PRODUCTION_DATABASE_URL_ENV} is set but could not be parsed.` };
    }
    hosts.push(...parsed.hosts);
  }
  return { ok: true, hosts };
}

function matchesProductionHost(hostname: string, productionHosts: string[]): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  const candidateKey = neonEndpointKey(host);
  for (const productionHost of productionHosts) {
    if (productionHost === host) return true;
    const productionKey = neonEndpointKey(productionHost);
    if (candidateKey && productionKey && candidateKey === productionKey) return true;
  }
  return false;
}

function refusal(purpose: string | undefined, detail: string): TestDatabaseVerdict {
  return {
    allowed: false,
    host: null,
    message: [
      `Refusing to run ${purposeLabel(purpose)}.`,
      detail,
      `Tests and seed scripts only run when DATABASE_URL uses localhost, 127.0.0.1, or ::1, a known test database, or a Neon branch database, or when ${TEST_DATABASE_OPT_IN_ENV}=1.`,
      `The production Neon host is refused even with that opt-in when ${PRODUCTION_NEON_HOST_ENV} or ${PRODUCTION_DATABASE_URL_ENV} identifies it.`,
    ].join(" "),
  };
}

function hostAllowed(parsed: ParsedConnection, host: string, productionHosts: string[]): boolean {
  return (
    isLocalDatabaseHost(host) ||
    isKnownTestDatabase(parsed.database, host) ||
    isNeonBranchDatabase(parsed, host, productionHosts)
  );
}

export function assessTestDatabase(input: AssessTestDatabaseInput): TestDatabaseVerdict {
  const env = input.env ?? process.env;
  const purpose = input.purpose;
  const production = loadProductionHosts(env);
  if (!production.ok) return refusal(purpose, production.detail);

  const raw = input.databaseUrl?.trim();
  if (!raw) {
    if (input.requireUrl) {
      return refusal(purpose, "DATABASE_URL is not set.");
    }
    return { allowed: true, host: null, message: "DATABASE_URL is unset; no database connection to guard." };
  }

  const parsed = parseDriverConnection(raw);
  if (!parsed) return refusal(purpose, "DATABASE_URL could not be parsed.");

  const host = parsed.hosts.join(",");
  if (!host) {
    return { ...refusal(purpose, "DATABASE_URL has no host."), host: null };
  }

  for (const candidate of parsed.hosts) {
    if (matchesProductionHost(candidate, production.hosts)) {
      return {
        allowed: false,
        host: candidate,
        message: [
          `Refusing to run ${purposeLabel(purpose)} against production Neon host "${candidate}".`,
          `${TEST_DATABASE_OPT_IN_ENV} does not override this.`,
          `The host matches ${PRODUCTION_NEON_HOST_ENV} or ${PRODUCTION_DATABASE_URL_ENV}.`,
        ].join(" "),
      };
    }
  }

  if (parsed.hosts.every((candidate) => hostAllowed(parsed, candidate, production.hosts))) {
    return { allowed: true, host, message: `DATABASE_URL host "${host}" is allowed for tests and seed scripts.` };
  }

  if (env[TEST_DATABASE_OPT_IN_ENV] === "1") {
    return {
      allowed: true,
      host,
      message: `DATABASE_URL host "${host}" is allowed because ${TEST_DATABASE_OPT_IN_ENV}=1.`,
    };
  }

  return {
    ...refusal(
      purpose,
      `DATABASE_URL host "${host}" is not local, not a known test database, and not a Neon branch database.`,
    ),
    host,
  };
}

export function assertSafeTestDatabase(
  input: AssessTestDatabaseInput & {
    exit?: (code: number) => void;
    write?: (message: string) => void;
  } = {},
): void {
  const verdict = assessTestDatabase(input);
  if (verdict.allowed) return;
  const write = input.write ?? ((message: string) => console.error(message));
  write(verdict.message);
  const exit = input.exit ?? ((code: number) => process.exit(code));
  exit(1);
}
