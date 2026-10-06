/**
 * Graph error codes Cerevex acts on for a long-lived user token.
 * 190 (any subcode, including 458, 460, and 463) means the sign-in is dead.
 * 4 and 17 are throttles. 341 is Meta's application limit. 80000, 80003, 80004,
 * and 80014 are Marketing API ad-account throttles. Those retry later.
 * 10 and 200–299 are missing permission.
 *
 * appsecret_proof is not sent. Facebook Login's security doc and the Graph
 * secure-requests doc both say a user token can carry the proof, and they
 * disagree on the HMAC input (the token alone, or the token, a bar, and a
 * unix time plus appsecret_time). A proof Meta rejects fails the call.
 * This build does not guess which formula the Marketing API accepts.
 */

export const META_TOKEN_EXPIRED = "meta.token_expired";
export const META_PERMISSION_MISSING = "meta.permission_missing";
export const META_RATE_LIMITED = "meta.rate_limited";

export const META_RECONNECT_MESSAGE = "Meta sign-in expired. Reconnect Meta for this site.";
export const META_PERMISSION_MESSAGE =
  "Connected, but Meta didn't grant ad management. Reconnect and allow it.";
export const META_RATE_LIMIT_MESSAGE = "Meta asked us to slow down. Cerevex will retry.";
export const META_CONNECT_INCOMPLETE = "Meta sign-in didn't complete. Nothing was saved.";
export const META_CONNECT_EXTEND_FAILED = "Meta couldn't extend the sign-in. Nothing was saved.";
export const META_REFRESH_FAILED = "Meta couldn't extend the sign-in. Connect again.";

/** Shown while the token still works. Fourteen days, per the accepted brief. */
export const META_EXPIRING_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

const RATE_LIMIT_CODES = new Set([4, 17, 341, 80000, 80003, 80004, 80014]);

export type MetaErrorCode =
  | typeof META_TOKEN_EXPIRED
  | typeof META_PERMISSION_MISSING
  | typeof META_RATE_LIMITED;

const SECRET_QUERY = /(access_token|client_secret|fb_exchange_token|refresh_token|code|appsecret_proof)=([^&\s#]+)/gi;

export function scrubMetaSecrets(value: string, secrets: readonly string[] = []): string {
  let out = value.replace(SECRET_QUERY, "$1=[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

export class MetaGraphError extends Error {
  readonly metaCode: MetaErrorCode;
  readonly graphCode: number;
  readonly graphSubcode: number | null;
  readonly retry: boolean;

  constructor(metaCode: MetaErrorCode, graphCode: number, graphSubcode: number | null) {
    super(metaCode);
    this.name = "MetaGraphError";
    this.metaCode = metaCode;
    this.graphCode = graphCode;
    this.graphSubcode = graphSubcode;
    this.retry = metaCode === META_RATE_LIMITED;
  }
}

export class MetaRefreshError extends Error {
  constructor() {
    super(META_REFRESH_FAILED);
    this.name = "MetaRefreshError";
  }
}

export function metaTokenExpiredError(): MetaGraphError {
  return new MetaGraphError(META_TOKEN_EXPIRED, 190, 463);
}

export function isMetaTokenExpired(error: unknown): error is MetaGraphError {
  return error instanceof MetaGraphError && error.metaCode === META_TOKEN_EXPIRED;
}

export function isMetaRateLimited(error: unknown): error is MetaGraphError {
  return error instanceof MetaGraphError && error.metaCode === META_RATE_LIMITED;
}

export function isMetaPermissionMissing(error: unknown): error is MetaGraphError {
  return error instanceof MetaGraphError && error.metaCode === META_PERMISSION_MISSING;
}

function metaCodeFor(code: number): MetaErrorCode | null {
  if (code === 190) return META_TOKEN_EXPIRED;
  if (code === 10 || (code >= 200 && code <= 299)) return META_PERMISSION_MISSING;
  if (RATE_LIMIT_CODES.has(code)) return META_RATE_LIMITED;
  return null;
}

export function classifyMetaGraphBody(body: unknown): MetaGraphError | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "number") return null;
  const metaCode = metaCodeFor(code);
  if (!metaCode) return null;
  const subcode = (error as { error_subcode?: unknown }).error_subcode;
  return new MetaGraphError(metaCode, code, typeof subcode === "number" ? subcode : null);
}

export function metaExpiryBand(
  expiresAt: string | null | undefined,
  now = Date.now(),
): "expired" | "expiring" | "fresh" | "unknown" {
  if (!expiresAt) return "unknown";
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return "unknown";
  if (at <= now) return "expired";
  if (at - now <= META_EXPIRING_WITHIN_MS) return "expiring";
  return "fresh";
}

export function metaExpiringMessage(expiresAt: string): string {
  const day = expiresAt.slice(0, 10);
  return `Meta sign-in ends ${day}. Reconnect before then to keep syncing.`;
}
