import { isProductionRuntime } from "@cerevex/contracts";

/**
 * Production refuses to boot without the ads API façade. The message names the
 * variables and never includes their values.
 */
export function assertMcpRuntimeConfigured(env: Record<string, string | undefined>): void {
  if (!isProductionRuntime(env)) return;
  if (!env.ADS_API_URL?.trim() || !env.ADS_INTERNAL_KEY?.trim()) {
    throw new Error("ADS_API_URL and ADS_INTERNAL_KEY are required");
  }
}

export function listenPort(raw: string | undefined, fallback = 4320): number {
  const value = raw == null || raw.trim() === "" ? String(fallback) : raw.trim();
  if (!/^\d+$/.test(value)) return Number.NaN;
  const port = Number(value);
  if (port < 1 || port > 65535) return Number.NaN;
  return port;
}
