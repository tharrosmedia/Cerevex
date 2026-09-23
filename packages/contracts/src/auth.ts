/**
 * Auth isolation (v0) — Product lock.
 *
 * OS brings workspace/client users in `apps/ads`.
 * Do not couple OS auth to Brain `APP_PASSWORD` in week one.
 * APP_PASSWORD, JWT_SECRET, and ADS_INTERNAL_KEY are secrets (see OPS_ENV_REGISTRY).
 * They are not product capabilities.
 */

export const OS_AUTH_HOME = "apps/ads" as const;
export const BRAIN_APP_PASSWORD_ENV = "APP_PASSWORD" as const;

export type OsAuthSurface = {
  home: typeof OS_AUTH_HOME;
  roles: ["owner", "operator", "client_readonly"];
  couplesToBrainAppPassword: false;
};

export const OS_AUTH: OsAuthSurface = {
  home: OS_AUTH_HOME,
  roles: ["owner", "operator", "client_readonly"],
  couplesToBrainAppPassword: false,
};
