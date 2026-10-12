import { isGoogleConfigured, isMetaConfigured, oauthHealthConfig } from "./oauth";

export const META_WORKER_STARTUP_WARNING =
  "Meta isn't set up on this worker. A real Meta token will not get test data.";

/** One startup warning when this process cannot call Meta. Null when it can. */
export function metaWorkerStartupWarning(): string | null {
  return isMetaConfigured() ? null : META_WORKER_STARTUP_WARNING;
}

export function warnIfMetaNotConfigured(warn: (message: string) => void): boolean {
  const message = metaWorkerStartupWarning();
  if (!message) return false;
  warn(message);
  return true;
}

export const GOOGLE_WORKER_STARTUP_WARNING =
  "Google isn't set up on this worker. A real Google token will not get test data.";

export const GOOGLE_API_STARTUP_WARNING =
  "Google isn't set up on this server. A real Google token will not get test data.";

/** One startup warning when this process cannot call Google. Null when it can. */
export function googleStartupWarning(kind: "worker" | "api"): string | null {
  if (isGoogleConfigured()) return null;
  return kind === "worker" ? GOOGLE_WORKER_STARTUP_WARNING : GOOGLE_API_STARTUP_WARNING;
}

export function warnIfGoogleNotConfigured(
  kind: "worker" | "api",
  warn: (message: string) => void,
): boolean {
  const message = googleStartupWarning(kind);
  if (!message) return false;
  warn(message);
  return true;
}

export function workerHealthBody(input: {
  dbOk: boolean;
  inngestStatus: "ok" | "degraded" | "down";
  functionIds: readonly string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return {
    ok: Boolean(input.dbOk),
    service: "tharros-worker",
    version: "0.1.0",
    time: now.toISOString(),
    checks: {
      db: input.dbOk ? "ok" : "down",
      inngest: input.inngestStatus,
      functions: input.functionIds,
    },
    oauth: oauthHealthConfig(now),
  };
}
