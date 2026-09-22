/**
 * Auth isolation (v0) — Product lock.
 *
 * OS brings workspace/client users in `apps/os`.
 * Do not couple OS auth to Brain `APP_PASSWORD` in week one.
 */

export const OS_AUTH_HOME = "apps/os" as const;
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
