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

export type SigningSecretProblem = "missing" | "short" | "placeholder";

function readEnv(env?: ProcessEnvMap): ProcessEnvMap {
  if (env) return env;
  const runtime = globalThis as { process?: { env?: ProcessEnvMap } };
  return runtime.process?.env ?? {};
}

/**
 * A production runtime fails closed on signing secrets and other required production env.
 *
 * True when any of these hold:
 * - NODE_ENV, RAILWAY_ENVIRONMENT, or RAILWAY_ENVIRONMENT_NAME equals `production` after trim and case-folding
 * - RAILWAY_ENVIRONMENT or RAILWAY_ENVIRONMENT_NAME is non-empty after trim, whatever the name is
 *   (`staging` and `production-eu` are deploys; they must not keep the JWT fallback)
 * - CEREVEX_REQUIRE_SIGNING_SECRETS is `1` or `true` (explicit flag for a host that is not Railway)
 *
 * Local dev and test leave both Railway variables unset and do not set the flag.
 * The Cerevex Railway production environment is literally named `production`.
 * Railway injects RAILWAY_ENVIRONMENT_NAME; it is not a dashboard variable. Reading it does not change Railway.
 */
export function isProductionRuntime(env?: ProcessEnvMap): boolean {
  const source = readEnv(env);
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
  return flag === "1" || flag === "true";
}

/** Classify a signing secret. Placeholder match is case-insensitive on the trimmed value. */
export function signingSecretProblem(
  raw: string | null | undefined,
  placeholders: readonly string[],
  minLength = MIN_SIGNING_SECRET_LENGTH,
): SigningSecretProblem | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "missing";
  const folded = trimmed.toLowerCase();
  if (placeholders.some((placeholder) => placeholder.trim().toLowerCase() === folded)) return "placeholder";
  if (trimmed.length < minLength) return "short";
  return null;
}
