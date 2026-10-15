const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]{2,64}$/i;

/**
 * Railway's edge sets X-Real-IP to the client remote address
 * (docs.railway.com public-networking specs). That value wins.
 * X-Forwarded-For is only a fallback, and then only the rightmost hop,
 * which a proxy appends. The left hops are client-controlled.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const real = normalizeIp(headers.get("x-real-ip")?.trim() ?? "");
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    for (let index = hops.length - 1; index >= 0; index -= 1) {
      const ip = normalizeIp(hops[index] ?? "");
      if (ip) return ip;
    }
  }
  return "unknown";
}

function normalizeIp(value: string): string | null {
  if (IPV4.test(value)) {
    const parts = value.split(".").map((part) => Number(part));
    if (parts.some((part) => part > 255)) return null;
    return parts.join(".");
  }
  if (value.includes(":") && IPV6.test(value) && !value.includes("%")) return value.toLowerCase();
  return null;
}

export function createDeniedIpLimiter(options: { limit: number; windowMs: number; now?: () => number; maxIps?: number }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const maxIps = options.maxIps ?? 4096;

  function prune(ip: string): number[] {
    const cutoff = now() - options.windowMs;
    const kept = (hits.get(ip) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) hits.delete(ip);
    else hits.set(ip, kept);
    return kept;
  }

  function oldestUnblocked(): string | null {
    let victim: string | null = null;
    let expiry = Number.POSITIVE_INFINITY;
    for (const [candidate, times] of hits) {
      if (times.length >= options.limit) continue;
      const candidateExpiry = (times[0] ?? 0) + options.windowMs;
      if (candidateExpiry < expiry) {
        victim = candidate;
        expiry = candidateExpiry;
      }
    }
    return victim;
  }

  return {
    retryAfterSeconds(ip: string): number | null {
      const kept = prune(ip);
      if (kept.length < options.limit) return null;
      const oldest = kept[0] ?? now();
      return Math.max(1, Math.ceil((oldest + options.windowMs - now()) / 1000));
    },
    record(ip: string) {
      const kept = prune(ip);
      const alreadyTracked = hits.has(ip);
      kept.push(now());
      hits.set(ip, kept);
      while (hits.size > maxIps) {
        const victim = oldestUnblocked();
        if (victim) {
          hits.delete(victim);
          continue;
        }
        if (!alreadyTracked && kept.length < options.limit) hits.delete(ip);
        break;
      }
    },
  };
}
