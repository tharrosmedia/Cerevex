const MAX_ORIGIN_LENGTH = 200;
const MAX_ALLOWED_ORIGINS = 32;

/**
 * Canonical scheme+host+port, or null when the value is not a single http(s) origin.
 * Userinfo, paths, queries, fragments, backslashes, and control characters are rejected
 * before the URL parser can treat them as the real host.
 */
export function canonicalOrigin(value: string): string | null {
  if (!value || value.length > MAX_ORIGIN_LENGTH) return null;
  if (value === "null" || value === "*") return null;
  if (value.includes("*") || value.includes("@") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  if (url.origin === "null") return null;
  return url.origin;
}

export function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const allowed = new Set<string>();
  if (!raw) return allowed;
  for (const part of raw.split(",")) {
    if (allowed.size >= MAX_ALLOWED_ORIGINS) break;
    const canonical = canonicalOrigin(part.trim());
    if (canonical) allowed.add(canonical);
  }
  return allowed;
}

export type OriginClass = "absent" | "allowed" | "rejected";

/** A missing Origin is a non-browser client. A present invalid Origin is rejected. */
export function classifyOrigin(header: string | null | undefined, allowed: ReadonlySet<string>): OriginClass {
  if (header == null) return "absent";
  const canonical = canonicalOrigin(header.trim());
  if (!canonical) return "rejected";
  if (!allowed.has(canonical)) return "rejected";
  return "allowed";
}
