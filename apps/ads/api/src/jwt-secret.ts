/** Pre-existing local fallback. Production services set JWT_SECRET; a missing value must not take the API down. */
export const JWT_LOCAL_FALLBACK = "replace-with-a-long-random-local-secret";

export function jwtSecretBytes(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET ?? JWT_LOCAL_FALLBACK);
}

export function warnIfJwtSecretUnset(log: (message: string) => void = console.warn): void {
  if (process.env.JWT_SECRET) return;
  log(
    "[auth] JWT_SECRET is unset. Ads sessions keep the built-in local fallback. Set JWT_SECRET before production traffic. The process will keep running.",
  );
}
