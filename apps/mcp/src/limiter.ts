const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]{2,64}$/i;

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    const ip = normalizeIp(first);
    if (ip) return ip;
  }
  const real = headers.get("x-real-ip");
  if (real) {
    const ip = normalizeIp(real.trim());
    if (ip) return ip;
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

  return {
    retryAfterSeconds(ip: string): number | null {
      const kept = prune(ip);
      if (kept.length < options.limit) return null;
      const oldest = kept[0] ?? now();
      return Math.max(1, Math.ceil((oldest + options.windowMs - now()) / 1000));
    },
    record(ip: string) {
      const kept = prune(ip);
      kept.push(now());
      hits.set(ip, kept);
      if (hits.size > maxIps) {
        const oldestIp = hits.keys().next().value;
        if (oldestIp) hits.delete(oldestIp);
      }
    },
  };
}
