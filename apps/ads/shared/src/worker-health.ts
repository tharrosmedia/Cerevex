import { isMetaConfigured, oauthConfig } from "./oauth";

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

export function workerHealthBody(input: {
  dbOk: boolean;
  inngestStatus: "ok" | "degraded" | "down";
  functionIds: readonly string[];
  now?: Date;
}) {
  return {
    ok: Boolean(input.dbOk),
    service: "tharros-worker",
    version: "0.1.0",
    time: (input.now ?? new Date()).toISOString(),
    checks: {
      db: input.dbOk ? "ok" : "down",
      inngest: input.inngestStatus,
      functions: input.functionIds,
    },
    oauth: oauthConfig(),
  };
}
