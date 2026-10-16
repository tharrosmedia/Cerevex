import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Per-request owner assertion (Cerevex Brain → ads-api).
 * HS256 compact JWS via node:crypto. This module is a package subpath so the
 * Brain edge bundle, which imports the contracts index, never loads node:crypto.
 */

export const OWNER_ASSERTION_ISS = "cerevex-brain";
export const OWNER_ASSERTION_AUD = "cerevex-ads-api";
export const OWNER_ASSERTION_ROLE = "owner";
export const OWNER_ASSERTION_TTL_SECONDS = 60;
export const OWNER_ASSERTION_LEEWAY_SECONDS = 30;
export const OWNER_ASSERTION_HEADER = "X-Cerevex-Owner-Assertion";

const MIN_KEY_BYTES = 32;
const CLAIM_KEYS = ["iss", "aud", "sub", "wid", "role", "htm", "htu", "iat", "exp", "jti"] as const;

export type OwnerAssertionKid = "cur" | "prev";

export type OwnerAssertionClaims = {
  iss: typeof OWNER_ASSERTION_ISS;
  aud: typeof OWNER_ASSERTION_AUD;
  sub: string;
  wid: string;
  role: typeof OWNER_ASSERTION_ROLE;
  htm: string;
  htu: string;
  iat: number;
  exp: number;
  jti: string;
};

export type OwnerAssertionRejectReason =
  | "missing_secret"
  | "malformed"
  | "bad_sig"
  | "expired"
  | "future_iat"
  | "wrong_iss_aud"
  | "wrong_htm_htu";

export type OwnerAssertionVerifyResult =
  | { ok: true; claims: OwnerAssertionClaims }
  | { ok: false; reason: OwnerAssertionRejectReason };

export type OwnerAssertionSignInput = {
  sub: string;
  wid: string;
  htm: string;
  htu: string;
  secret: string;
  /** Hint only. Verification tries the current key, then the previous key. */
  kid?: OwnerAssertionKid;
  /** Unix seconds. Defaults to now. exp is iat + 60. */
  now?: number;
  /** 128 random bits, base64url. Generated when omitted. */
  jti?: string;
};

/**
 * Key material is the base64url decoding of the secret.
 * The secret must be at least 32 random bytes, encoded base64url, with no whitespace.
 * Returns null when the value is missing, short, or not canonical base64url.
 */
export function ownerAssertionKeyBytes(secret: string | null | undefined): Uint8Array | null {
  if (secret == null || secret.length === 0) return null;
  if (secret !== secret.trim()) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  const bytes = Buffer.from(secret, "base64url");
  if (bytes.length < MIN_KEY_BYTES) return null;
  if (Buffer.from(bytes).toString("base64url") !== secret) return null;
  return bytes;
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signaturesMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 10_000_000_000;
}

function isJti(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 16 && bytes.toString("base64url") === value;
}

function isSubject(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 320 && value === value.toLowerCase() && !/\s/.test(value);
}

function isWid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/\s/.test(value);
}

function isHtm(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{1,16}$/.test(value);
}

function isHtu(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/\s/.test(value) &&
    !value.includes("://")
  );
}

function readClaims(value: unknown): OwnerAssertionClaims | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== CLAIM_KEYS.length || CLAIM_KEYS.some((key) => !Object.hasOwn(record, key))) return null;
  if (record.iss !== OWNER_ASSERTION_ISS || record.aud !== OWNER_ASSERTION_AUD) return null;
  if (record.role !== OWNER_ASSERTION_ROLE) return null;
  if (!isSubject(record.sub) || !isWid(record.wid) || !isHtm(record.htm) || !isHtu(record.htu)) return null;
  if (!isUnixSeconds(record.iat) || !isUnixSeconds(record.exp) || !isJti(record.jti)) return null;
  if (record.exp !== record.iat + OWNER_ASSERTION_TTL_SECONDS) return null;
  return {
    iss: OWNER_ASSERTION_ISS,
    aud: OWNER_ASSERTION_AUD,
    sub: record.sub,
    wid: record.wid,
    role: OWNER_ASSERTION_ROLE,
    htm: record.htm,
    htu: record.htu,
    iat: record.iat,
    exp: record.exp,
    jti: record.jti,
  };
}

function headerOk(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const header = value as Record<string, unknown>;
  const keys = Object.keys(header);
  if (keys.length !== 3) return false;
  return header.alg === "HS256" && header.typ === "JWT" && (header.kid === "cur" || header.kid === "prev");
}

export function signOwnerAssertion(input: OwnerAssertionSignInput): string {
  const key = ownerAssertionKeyBytes(input.secret);
  if (!key) throw new Error("CEREVEX_OWNER_ASSERTION_SECRET is missing or short");
  const sub = input.sub.trim().toLowerCase();
  const iat = input.now ?? Math.floor(Date.now() / 1000);
  const jti = input.jti ?? randomBytes(16).toString("base64url");
  const claims: OwnerAssertionClaims = {
    iss: OWNER_ASSERTION_ISS,
    aud: OWNER_ASSERTION_AUD,
    sub,
    wid: input.wid,
    role: OWNER_ASSERTION_ROLE,
    htm: input.htm,
    htu: input.htu,
    iat,
    exp: iat + OWNER_ASSERTION_TTL_SECONDS,
    jti,
  };
  if (!readClaims(claims)) throw new Error("Owner assertion claims are incomplete");
  const kid = input.kid ?? "cur";
  const header = b64urlJson({ alg: "HS256", typ: "JWT", kid });
  const payload = b64urlJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", key).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function mac(key: Uint8Array, signingInput: string): string {
  return createHmac("sha256", key).update(signingInput).digest("base64url");
}

/**
 * Verify an HS256 owner assertion.
 * `kid` is ignored. The current key is tried, then the optional previous key.
 * `htm` and `htu`, when passed, must match the claims. `now` is unix seconds.
 * An `iat` more than 30s in the future is rejected. `exp` allows the same 30s leeway.
 */
export function verifyOwnerAssertion(
  token: string,
  options: {
    current?: string | null;
    previous?: string | null;
    now?: number;
    htm?: string;
    htu?: string;
  },
): OwnerAssertionVerifyResult {
  const current = ownerAssertionKeyBytes(options.current);
  if (!current) return { ok: false, reason: "missing_secret" };
  const previous = ownerAssertionKeyBytes(options.previous);

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return { ok: false, reason: "malformed" };
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!headerOk(header)) return { ok: false, reason: "malformed" };

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const currentOk = signaturesMatch(signature, mac(current, signingInput));
  const previousOk = previous ? signaturesMatch(signature, mac(previous, signingInput)) : false;
  if (!currentOk && !previousOk) return { ok: false, reason: "bad_sig" };

  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (
      Object.hasOwn(record, "iss") &&
      Object.hasOwn(record, "aud") &&
      (record.iss !== OWNER_ASSERTION_ISS || record.aud !== OWNER_ASSERTION_AUD)
    ) {
      return { ok: false, reason: "wrong_iss_aud" };
    }
  }

  const claims = readClaims(payload);
  if (!claims) return { ok: false, reason: "malformed" };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (claims.iat > now + OWNER_ASSERTION_LEEWAY_SECONDS) return { ok: false, reason: "future_iat" };
  if (claims.exp + OWNER_ASSERTION_LEEWAY_SECONDS < now) return { ok: false, reason: "expired" };

  if ((options.htm !== undefined && claims.htm !== options.htm) || (options.htu !== undefined && claims.htu !== options.htu)) {
    return { ok: false, reason: "wrong_htm_htu" };
  }

  return { ok: true, claims };
}
