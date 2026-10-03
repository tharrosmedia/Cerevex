import { JWT_LOCAL_FALLBACK, isProductionRuntime, signingSecretProblem } from "@cerevex/contracts";
import { assertAdsApiProductionSecrets } from "@tharros/ads-shared/production-secrets";

/** Pre-existing local fallback. Dev and test only. Production must set JWT_SECRET. */
export { JWT_LOCAL_FALLBACK };

/** Trimmed JWT_SECRET, or null when production rejects it or the value is unset. */
export function configuredJwtSecret(): string | null {
  const trimmed = (process.env.JWT_SECRET ?? "").trim();
  const problem = signingSecretProblem(process.env.JWT_SECRET, [JWT_LOCAL_FALLBACK]);
  if (!isProductionRuntime()) return problem === "missing" ? null : trimmed;
  return problem ? null : trimmed;
}

/**
 * HMAC key. A production runtime with a missing, short, or placeholder secret throws
 * so sign and verify both fail closed. Dev and test keep the local fallback when unset.
 */
export function jwtSecretBytes(): Uint8Array {
  const configured = configuredJwtSecret();
  if (configured) return new TextEncoder().encode(configured);
  if (isProductionRuntime()) {
    throw new Error("JWT_SECRET is required in production. Refusing to sign or verify sessions.");
  }
  return new TextEncoder().encode(JWT_LOCAL_FALLBACK);
}

/** Call on ads-api boot. Exits the process when a production runtime lacks usable ads secrets. */
export function assertJwtSecretConfigured(): void {
  assertAdsApiProductionSecrets();
}

export function warnIfJwtSecretUnset(log: (message: string) => void = console.warn): void {
  if (configuredJwtSecret()) return;
  if (isProductionRuntime()) {
    log(
      "[auth] JWT_SECRET is missing, too short, or the local placeholder. Refusing to sign or verify sessions in production.",
    );
    return;
  }
  log(
    "[auth] JWT_SECRET is unset. Ads sessions keep the built-in local fallback. Set JWT_SECRET before production traffic. The process will keep running.",
  );
}
