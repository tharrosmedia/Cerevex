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
 * PRODUCTION_NEON_HOST may be a bare host, host:port, or any scheme URL.
 * `postgres://` and `postgresql://` are parsed with the driver, so `?host=`
 * is the host that is denied. Other schemes use the URL hostname. A single
 * trailing dot is stripped (`127.0.0.1.`, `localhost.`). More than one
 * trailing dot is refused, including an IDNA form whose ASCII result ends in
 * `..` (`localhost。。`). Hostnames go through `domainToASCII`; a non-ASCII host
 * that does not convert fails closed. A Neon `options=endpoint=` or
 * `options=project=` id, including one inside `PRODUCTION_DATABASE_URL` or
 * `PGOPTIONS`, matches a configured production endpoint even when the URL host
 * is different. The same id in the password (`endpoint=<id>;…` or
 * `endpoint=<id>$…`, or `PGPASSWORD` when the URL has no password) is treated
 * the same way, and that routing id stops a test-looking database name and a
 * `ci`, `test`, or `br-` host label from allowing a remote host. Production
 * URLs are parsed with an empty env, so `PGOPTIONS` and `PGPASSWORD` are not
 * copied into the production endpoint set. `~/.pgpass` and `PGPASSFILE` are
 * not read; a routing id that exists only there is not checked. Empty or
 * whitespace-only values of either variable are unset.
 * A non-empty value that does not parse fails closed. A host that still
 * contains `%` after the driver parse is refused unless it is an IPv6 zone
 * id. `domainToASCII` would percent-decode it again; node-postgres looks up
 * the literal name. Surrounding whitespace is part of that name and is
 * refused. A C0 control or DEL is refused before `domainToASCII`. An IPv4
 * rewrite is accepted only when every dot-separated part is a decimal or
 * `0x` hex integer (`127.1`, `0x7f000001`). `127.0x.0x.1` is not. That
 * rewrite is refused with a trailing dot (`127.1.`, `0x7f000001.`). A
 * non-ASCII host that converts to an IP is refused.
 *
 * Without PRODUCTION_NEON_HOST or PRODUCTION_DATABASE_URL, an unmarked Neon
 * host is only a normal remote host: refused by default, allowed with the
 * opt-in. The guard cannot tell a production compute from a branch compute
 * by hostname shape alone.
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

import "server-only";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
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
  endpointIds: string[];
};

type ProductionConfig = { ok: true; hosts: string[]; endpointIds: string[] } | { ok: false; detail: string };

function purposeLabel(purpose: string | undefined): string {
  return purpose?.trim() || "this database command";
}

/** Decimal or `0x` hex. `0x` with no digits does not match. */
const INET_ATON_PART = /^(?:0x[0-9a-f]+|[0-9]+)$/i;

/** C0 controls, space, and DEL. `domainToASCII` would otherwise swallow these. */
const HOST_CONTROL = /[\u0000-\u0020\u007f]/;

function isInetAtonForm(host: string): boolean {
  const bare = host.replace(/\.+$/, "");
  if (!bare) return false;
  return bare.split(".").every((part) => INET_ATON_PART.test(part));
}

/** ASCII `.` on the raw host. IDNA dots are checked after `domainToASCII`. */
function trailingDotCount(host: string): number {
  let count = 0;
  for (let i = host.length - 1; i >= 0 && host.charCodeAt(i) === 0x2e; i -= 1) count += 1;
  return count;
}

/**
 * Returns null when a non-empty host is non-ASCII and `domainToASCII` cannot
 * turn it into ASCII, or when that conversion would not be the name
 * node-postgres looks up. Empty input stays empty. IPv4, IPv6 (including a
 * zone id), and socket paths are not passed through `domainToASCII`.
 */
function normalizeHost(hostname: string): string | null {
  // pg does not trim. `127.0.0.1\t` and ` localhost` are literal lookup names.
  if (hostname !== hostname.trim()) return null;
  let host = hostname;
  if (!host) return "";
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.startsWith("/")) return host.toLowerCase();
  // `domainToASCII` percent-decodes. A leftover `%` is a literal DNS label
  // for pg, except an IPv6 zone id (`fe80::1%eth0`), which `isIP` accepts.
  if (host.includes("%") && isIP(host) !== 6) return null;
  // `127.0.0.1.` and `localhost.` are loopback. `127.0.0.1..` and `localhost..` are not.
  const trailingDots = trailingDotCount(host);
  if (trailingDots > 1) return null;
  if (isIP(host)) return host.toLowerCase().replace(/\.+$/, "");
  if (HOST_CONTROL.test(host)) return null;
  const ascii = domainToASCII(host);
  if (!ascii || /[^\u0000-\u007f]/.test(ascii)) return null;
  // `。`, `．`, and `｡` become `.` here. A soft hyphen or zero-width space is
  // dropped, so `localhost。。` and `localhost.\u200B.` are `localhost..`.
  if (/\.\.$/.test(ascii)) return null;
  const stripped = ascii.replace(/\.+$/, "").toLowerCase();
  if (!stripped) return null;
  // Fullwidth digits, ideographic dots, a soft hyphen, or a zero-width space
  // become an IP here while Node looks the original name up in DNS.
  if (isIP(stripped) !== 0 && /[^\u0000-\u007f]/.test(host)) return null;
  // ASCII may change only by case folding, one trailing dot, or an inet_aton
  // form Node resolves itself (`127.1`, `0x7f.0.0.1`). `127.0x.0x.1` is a DNS name.
  // A trailing dot on that rewrite (`127.1.`, `0x7f000001.`) is not loopback.
  if (!/[^\u0000-\u007f]/.test(host)) {
    const folded = host.replace(/\.+$/, "").toLowerCase();
    const inetAton = folded !== stripped && isIP(stripped) !== 0 && isInetAtonForm(folded);
    if (folded !== stripped && !inetAton) return null;
    if (trailingDots > 0 && inetAton) return null;
  }
  return stripped;
}

function isAbsoluteConnectionString(value: string): boolean {
  return /^(?:postgres|postgresql):\/\//i.test(value) || value.startsWith("/");
}

function blankEnv(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/** One DNS label: no empty label, and no leading or trailing hyphen. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/i;
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

function connectionHosts(hostField: string): string[] | null {
  const hosts: string[] = [];
  for (const part of hostField.split(",")) {
    if (!part.trim()) continue;
    const host = normalizeHost(part);
    if (host === null) return null;
    if (host) hosts.push(host);
  }
  return hosts;
}

function isHostname(value: string): boolean {
  if (!value || value.length > 253) return false;
  return value.split(".").every((label) => HOST_LABEL.test(label));
}

function endpointKey(id: string): string | null {
  const key = id.trim().toLowerCase().replace(/-pooler$/, "");
  return key.startsWith("ep-") ? key : null;
}

function endpointIdsFromOptions(options: string): string[] {
  const ids: string[] = [];
  const pattern = /(?:^|[\s;])(?:endpoint|project)=([a-z0-9_-]+)/gi;
  for (const match of options.matchAll(pattern)) {
    const id = endpointKey(match[1] ?? "");
    if (id) ids.push(id);
  }
  return ids;
}

/** Neon proxy password routing: `endpoint=<id>;<pw>` or `endpoint=<id>$<pw>`. */
function endpointIdsFromPassword(password: string): string[] {
  const match = /^(?:endpoint|project)=([a-z0-9_-]+)[;$]/i.exec(password);
  const id = endpointKey(match?.[1] ?? "");
  return id ? [id] : [];
}

/**
 * Parse with the same library node-postgres uses. Returns null when the
 * string is not a postgres URL or socket path, or when the parser throws.
 * Relative garbage is not treated as a successful parse: the library would
 * otherwise resolve it against an internal `postgres://base` placeholder.
 */
function parseDriverConnection(raw: string, env: EnvLike = {}): ParsedConnection | null {
  const trimmed = raw.trim();
  if (!trimmed || !isAbsoluteConnectionString(trimmed)) return null;
  let config: ConnectionOptions;
  try {
    config = parseConnectionString(trimmed);
  } catch {
    return null;
  }
  const hostField = typeof config.host === "string" ? config.host : "";
  const hosts = connectionHosts(hostField);
  if (!hosts) return null;
  const database = typeof config.database === "string" ? config.database.toLowerCase() : "";
  const urlOptions = typeof config.options === "string" ? config.options.trim() : "";
  const urlPassword = typeof config.password === "string" ? config.password : "";
  const options = urlOptions || env.PGOPTIONS?.trim() || "";
  const password = urlPassword || env.PGPASSWORD || "";
  return {
    hosts,
    database,
    endpointIds: [...endpointIdsFromOptions(options), ...endpointIdsFromPassword(password)],
  };
}

function isTestDatabaseName(name: string): boolean {
  return TEST_DATABASE_NAME.test(name);
}

export function isLocalDatabaseHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (host.startsWith("/")) return true;
  return LOCAL_HOSTS.has(host);
}

function isKnownTestDatabase(database: string, host: string, routedByEndpoint: boolean): boolean {
  if (routedByEndpoint) return false;
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

function isNeonBranchDatabase(
  parsed: ParsedConnection,
  host: string,
  production: ProductionConfig & { ok: true },
): boolean {
  if (!isNeonHost(host) || matchesProductionHost(host, production)) return false;
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
function hostsFromToken(token: string): { hosts: string[]; endpointIds: string[] } | null {
  const trimmed = token.trim();
  if (!trimmed) return { hosts: [], endpointIds: [] };
  if (/^(?:postgres|postgresql):\/\//i.test(trimmed)) {
    const parsed = parseDriverConnection(trimmed, {});
    if (!parsed || parsed.hosts.length === 0) return null;
    return { hosts: parsed.hosts, endpointIds: parsed.endpointIds };
  }
  if (SCHEME_URL.test(trimmed)) {
    try {
      const host = normalizeHost(new URL(trimmed).hostname);
      return host && isHostname(host) ? { hosts: [host], endpointIds: [] } : null;
    } catch {
      return null;
    }
  }
  if (/[\s/]/.test(trimmed) || trimmed.includes("://")) return null;
  const portMatch = /^(.*):(\d+)$/.exec(trimmed);
  const bare = portMatch ? portMatch[1] : trimmed;
  const host = normalizeHost(bare ?? "");
  return host && isHostname(host) ? { hosts: [host], endpointIds: [] } : null;
}

function hostsFromListedValue(value: string): { hosts: string[]; endpointIds: string[] } | null {
  const hosts: string[] = [];
  const endpointIds: string[] = [];
  for (const part of value.split(",")) {
    const parsed = hostsFromToken(part);
    if (!parsed) return null;
    hosts.push(...parsed.hosts);
    endpointIds.push(...parsed.endpointIds);
  }
  return hosts.length > 0 || endpointIds.length > 0 ? { hosts, endpointIds } : null;
}

function loadProductionHosts(env: EnvLike): ProductionConfig {
  const hosts: string[] = [];
  const endpointIds: string[] = [];
  const listed = env[PRODUCTION_NEON_HOST_ENV];
  if (!blankEnv(listed)) {
    const parsed = hostsFromListedValue(listed ?? "");
    if (!parsed) {
      return { ok: false, detail: `${PRODUCTION_NEON_HOST_ENV} is set but could not be parsed.` };
    }
    hosts.push(...parsed.hosts);
    endpointIds.push(...parsed.endpointIds);
  }
  const databaseUrl = env[PRODUCTION_DATABASE_URL_ENV];
  if (!blankEnv(databaseUrl)) {
    const parsed = parseDriverConnection(databaseUrl ?? "", {});
    if (!parsed || parsed.hosts.length === 0) {
      return { ok: false, detail: `${PRODUCTION_DATABASE_URL_ENV} is set but could not be parsed.` };
    }
    hosts.push(...parsed.hosts);
    endpointIds.push(...parsed.endpointIds);
  }
  return { ok: true, hosts, endpointIds };
}

function matchesProductionEndpointId(endpointId: string, production: ProductionConfig & { ok: true }): boolean {
  const key = endpointKey(endpointId);
  if (!key) return false;
  if (production.endpointIds.includes(key)) return true;
  return production.hosts.some((host) => neonEndpointKey(host) === key);
}

function matchesProductionHost(hostname: string, production: ProductionConfig & { ok: true }): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (production.hosts.includes(host)) return true;
  const candidateKey = neonEndpointKey(host);
  if (!candidateKey) return false;
  if (production.endpointIds.includes(candidateKey)) return true;
  return production.hosts.some((productionHost) => neonEndpointKey(productionHost) === candidateKey);
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

function hostAllowed(parsed: ParsedConnection, host: string, production: ProductionConfig & { ok: true }): boolean {
  const routedByEndpoint = parsed.endpointIds.length > 0;
  return (
    isLocalDatabaseHost(host) ||
    isKnownTestDatabase(parsed.database, host, routedByEndpoint) ||
    (!routedByEndpoint && isNeonBranchDatabase(parsed, host, production))
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

  const parsed = parseDriverConnection(raw, env);
  if (!parsed) return refusal(purpose, "DATABASE_URL could not be parsed.");

  const host = parsed.hosts.join(",");
  if (!host) {
    return { ...refusal(purpose, "DATABASE_URL has no host."), host: null };
  }

  for (const candidate of parsed.hosts) {
    if (matchesProductionHost(candidate, production)) {
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

  for (const endpointId of parsed.endpointIds) {
    if (matchesProductionEndpointId(endpointId, production)) {
      return {
        allowed: false,
        host: host || null,
        message: [
          `Refusing to run ${purposeLabel(purpose)} against production Neon endpoint "${endpointId}".`,
          `${TEST_DATABASE_OPT_IN_ENV} does not override this.`,
          `The connection options endpoint matches ${PRODUCTION_NEON_HOST_ENV} or ${PRODUCTION_DATABASE_URL_ENV}.`,
        ].join(" "),
      };
    }
  }

  if (parsed.hosts.every((candidate) => hostAllowed(parsed, candidate, production))) {
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
