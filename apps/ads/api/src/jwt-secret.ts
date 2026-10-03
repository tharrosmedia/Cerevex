/** Pre-existing local fallback. Dev and test only. Production must set JWT_SECRET. */
export const JWT_LOCAL_FALLBACK = "replace-with-a-long-random-local-secret";

/** Trimmed JWT_SECRET, or null when it is unset, empty, or whitespace. */
export function configuredJwtSecret(): string | null {
  const trimmed = (process.env.JWT_SECRET ?? "").trim();
  return trimmed ? trimmed : null;
}

/** Same production signals as Brain: NODE_ENV or either Railway environment name. */
export function isAdsProduction(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return [process.env.RAILWAY_ENVIRONMENT, process.env.RAILWAY_ENVIRONMENT_NAME].some(
    (name) => (name || "").toLowerCase() === "production",
  );
}

/**
 * HMAC key. Production with an empty secret throws so sign and verify both fail closed.
 * Dev and test keep the local fallback.
 */
export function jwtSecretBytes(): Uint8Array {
  const configured = configuredJwtSecret();
  if (configured) return new TextEncoder().encode(configured);
  if (isAdsProduction()) {
    throw new Error("JWT_SECRET is required in production. Refusing to sign or verify sessions.");
  }
  return new TextEncoder().encode(JWT_LOCAL_FALLBACK);
}

/** Call on ads-api boot. Exits the process when production has no usable JWT_SECRET. */
export function assertJwtSecretConfigured(): void {
  if (!isAdsProduction()) return;
  if (configuredJwtSecret()) return;
  throw new Error("JWT_SECRET is required in production. Refusing to boot.");
}

export function warnIfJwtSecretUnset(log: (message: string) => void = console.warn): void {
  if (configuredJwtSecret()) return;
  if (isAdsProduction()) {
    log(
      "[auth] JWT_SECRET is unset or whitespace. Refusing to sign or verify sessions in production.",
    );
    return;
  }
  log(
    "[auth] JWT_SECRET is unset. Ads sessions keep the built-in local fallback. Set JWT_SECRET before production traffic. The process will keep running.",
  );
}
