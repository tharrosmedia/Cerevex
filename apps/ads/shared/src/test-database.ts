/**
 * Hard guard for test entrypoints and seed scripts that open a real database.
 *
 * Allowed hosts:
 * - localhost, 127.0.0.1, or ::1
 * - a known test database (name `test`, `*_test`, `*-test`, or a host label `test` / `ci`)
 * - a Neon branch database (`*.neon.tech` with an explicit branch marker)
 * - any other host when ALLOW_NONLOCAL_TEST_DB=1
 *
 * Production Neon host:
 * The production compute hostname is not committed, and Railway variable values
 * are not readable, so it is not hardcoded. Neon branch computes use the same
 * `ep-<id>[-pooler].<region>.aws.neon.tech` shape as the default branch, so a
 * hostname regex cannot tell them apart. If PRODUCTION_NEON_HOST or
 * PRODUCTION_DATABASE_URL is present in the environment, that host (and the
 * matching Neon pooler/direct twin) is refused even when the opt-in is set.
 *
 * Wired from:
 * - apps/ads/shared/src/seed.ts
 * - apps/ads/api/test/setup-database-guard.ts (vitest setup for every ads API test)
 *
 * No other apps/ or packages/ test entrypoint or seed script opens a real
 * database. Brain tests are in-memory. packages/db and packages/shared have no
 * runners. Migrate scripts are intentional ops paths and are not guarded.
 */

export const TEST_DATABASE_OPT_IN_ENV = "ALLOW_NONLOCAL_TEST_DB";
export const PRODUCTION_NEON_HOST_ENV = "PRODUCTION_NEON_HOST";
export const PRODUCTION_DATABASE_URL_ENV = "PRODUCTION_DATABASE_URL";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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

function purposeLabel(purpose: string | undefined): string {
  return purpose?.trim() || "this database command";
}

function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
}

function databaseName(url: URL): string {
  const raw = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export function isLocalDatabaseHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(normalizeHost(hostname));
}

function isKnownTestDatabase(url: URL, host: string): boolean {
  const name = databaseName(url);
  if (name === "test" || name.endsWith("_test") || name.endsWith("-test")) return true;
  return host.split(".").some((label) => label === "test" || label === "ci");
}

function isNeonHost(host: string): boolean {
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

function isNeonBranchDatabase(url: URL, host: string): boolean {
  if (!isNeonHost(host)) return false;
  const endpoint = host.split(".")[0] ?? "";
  if (endpoint.includes("branch")) return true;
  const name = databaseName(url);
  if (name.includes("branch") || name.includes("preview")) return true;
  const search = `${url.search}${url.hash}`.toLowerCase();
  return search.includes("branch=") || search.includes("br-");
}

function hostFromValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    try {
      return normalizeHost(new URL(trimmed).hostname);
    } catch {
      return null;
    }
  }
  return normalizeHost(trimmed.split("/")[0]?.split(":")[0] ?? trimmed);
}

function neonEndpointKey(host: string): string | null {
  if (!isNeonHost(host)) return null;
  const first = host.split(".")[0] ?? "";
  if (!first.startsWith("ep-")) return null;
  return first.replace(/-pooler$/, "");
}

function configuredProductionHosts(env: EnvLike): string[] {
  const hosts: string[] = [];
  const listed = env[PRODUCTION_NEON_HOST_ENV];
  if (listed) {
    for (const part of listed.split(",")) {
      const host = hostFromValue(part);
      if (host) hosts.push(host);
    }
  }
  const databaseUrl = env[PRODUCTION_DATABASE_URL_ENV];
  if (databaseUrl) {
    const host = hostFromValue(databaseUrl);
    if (host) hosts.push(host);
  }
  return hosts;
}

export function isProductionNeonHost(hostname: string, env: EnvLike = process.env): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  const candidateKey = neonEndpointKey(host);
  for (const productionHost of configuredProductionHosts(env)) {
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

export function assessTestDatabase(input: AssessTestDatabaseInput): TestDatabaseVerdict {
  const env = input.env ?? process.env;
  const purpose = input.purpose;
  const raw = input.databaseUrl?.trim();
  if (!raw) {
    if (input.requireUrl) {
      return refusal(purpose, "DATABASE_URL is not set.");
    }
    return { allowed: true, host: null, message: "DATABASE_URL is unset; no database connection to guard." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refusal(purpose, "DATABASE_URL could not be parsed.");
  }

  const host = normalizeHost(url.hostname);
  if (!host) {
    return { ...refusal(purpose, "DATABASE_URL has no host."), host: null };
  }

  if (isProductionNeonHost(host, env)) {
    return {
      allowed: false,
      host,
      message: [
        `Refusing to run ${purposeLabel(purpose)} against production Neon host "${host}".`,
        `${TEST_DATABASE_OPT_IN_ENV} does not override this.`,
        `The host matches ${PRODUCTION_NEON_HOST_ENV} or ${PRODUCTION_DATABASE_URL_ENV}.`,
      ].join(" "),
    };
  }

  if (isLocalDatabaseHost(host) || isKnownTestDatabase(url, host) || isNeonBranchDatabase(url, host)) {
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
