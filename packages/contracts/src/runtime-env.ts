import type { ProcessEnvMap } from "./capabilities";

/**
 * Minimum length for JWT_SECRET and TOKEN_ENCRYPTION_KEY in a production runtime.
 * The .env.example placeholders are longer than this, so length alone does not reject them.
 */
export const MIN_SIGNING_SECRET_LENGTH = 32;

/** Ads JWT local fallback. Dev and test only. Never deploy this value. */
export const JWT_LOCAL_FALLBACK = "replace-with-a-long-random-local-secret";

/** Ads token-encryption local key. Dev and test only, and only when TOKEN_ENCRYPTION_KEY is unset. */
export const LOCAL_DEV_TOKEN_KEY = "local-dev-only-token-key-32b!!";

/** Brain console placeholder from apps/brain/.env.example. Production must not use it. */
export const APP_PASSWORD_PLACEHOLDER = "change-this-to-secure-password";

export type SigningSecretProblem = "missing" | "short" | "placeholder";

function readEnv(env?: ProcessEnvMap): ProcessEnvMap | null {
  if (env) return env;
  const runtime = globalThis as { process?: { env?: ProcessEnvMap } };
  if (runtime.process == null) return null;
  return runtime.process.env ?? {};
}

/**
 * A production runtime fails closed on signing secrets and other required production env.
 *
 * True when any of these hold:
 * - NODE_ENV, RAILWAY_ENVIRONMENT, or RAILWAY_ENVIRONMENT_NAME equals `production` after trim and case-folding
 * - RAILWAY_ENVIRONMENT or RAILWAY_ENVIRONMENT_NAME is non-empty after trim, whatever the name is
 *   (`staging` and `production-eu` are deploys; they must not keep the JWT fallback)
 * - CEREVEX_REQUIRE_SIGNING_SECRETS is `1`, `true`, or `yes` (explicit flag for a host that is not Railway)
 *
 * Local dev and test leave both Railway variables unset and do not set the flag.
 * The Cerevex Railway production environment is literally named `production`.
 * Railway injects RAILWAY_ENVIRONMENT_NAME; it is not a dashboard variable. Reading it does not change Railway.
 * If `process` is missing and no env map was passed, this returns true so secret checks fail closed.
 */
export function isProductionRuntime(env?: ProcessEnvMap): boolean {
  const source = readEnv(env);
  if (!source) return true;
  const folded = (value: string | undefined) => (value ?? "").trim().toLowerCase();
  if (
    folded(source.NODE_ENV) === "production" ||
    folded(source.RAILWAY_ENVIRONMENT) === "production" ||
    folded(source.RAILWAY_ENVIRONMENT_NAME) === "production"
  ) {
    return true;
  }
  if ((source.RAILWAY_ENVIRONMENT ?? "").trim() || (source.RAILWAY_ENVIRONMENT_NAME ?? "").trim()) {
    return true;
  }
  const flag = folded(source.CEREVEX_REQUIRE_SIGNING_SECRETS);
  return flag === "1" || flag === "true" || flag === "yes";
}

/** Unicode code points. An emoji is one, not two UTF-16 units. */
function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/**
 * Classify a signing secret. Placeholder match is case-insensitive on the trimmed value.
 * The minimum length counts Unicode code points, not UTF-16 code units.
 * This does not trim the value used as key material. Callers that must keep old ciphertext
 * derive from the raw string.
 */
export function signingSecretProblem(
  raw: string | null | undefined,
  placeholders: readonly string[],
  minLength = MIN_SIGNING_SECRET_LENGTH,
): SigningSecretProblem | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "missing";
  const folded = trimmed.toLowerCase();
  if (placeholders.some((placeholder) => placeholder.trim().toLowerCase() === folded)) return "placeholder";
  if (codePointLength(trimmed) < minLength) return "short";
  return null;
}
