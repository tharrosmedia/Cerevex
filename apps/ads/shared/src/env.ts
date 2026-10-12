import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Server-only: import via `@tharros/ads-shared/env`, never the package root.

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"), // apps/ads/.env when cwd is api/web/shared/workers
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../../../.env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, override: false });
    }
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Optional environment value. Unset, empty, and whitespace-only values are absent.
 * The raw value is never logged and never included in an error.
 *
 * `GOOGLE_ADS_DEVELOPER_TOKEN` is optional (Q7). Callers send `developer-token`
 * only when `googleAdsDeveloperToken()` returns a value. A missing token must
 * not block list, pull, live re-read, or mutate.
 */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function googleAdsDeveloperToken(): string | undefined {
  return optionalEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
}
