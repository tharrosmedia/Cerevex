import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 hex of the exact UTF-8 token, including the cxm_ prefix. */
export const MCP_TOKEN_HASH_HEX = /^[0-9a-f]{64}$/;

const TOKEN = /^cxm_[A-Za-z0-9_-]{43}$/;

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createMcpToken(): { token: string; tokenHash: string } {
  const token = `cxm_${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashMcpToken(token) };
}

/** Authorization header only. Query strings and other schemes are not tokens. */
export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
  const token = match?.[1];
  if (!token || !TOKEN.test(token)) return null;
  return token;
}

export function tokenHashesMatch(left: string, right: string): boolean {
  if (!MCP_TOKEN_HASH_HEX.test(left) || !MCP_TOKEN_HASH_HEX.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
