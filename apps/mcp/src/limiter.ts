const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * X-Real-IP wins when it parses. An invalid X-Real-IP does not fall through
 * to X-Forwarded-For. X-Forwarded-For uses only the rightmost hop. An
 * unparseable rightmost hop does not walk left. Either failure uses the
 * socket address, or "unknown" when there is no socket.
 * IPv6 keys are the /64, so a client rotating inside its prefix stays one key.
 */
export function clientIpFromHeaders(headers: Headers, socketIp?: string | null): string {
  const realHeader = headers.get("x-real-ip");
  if (realHeader != null && realHeader.trim() !== "") {
    const real = normalizeIp(realHeader.trim());
    if (real) return real;
    return socketOrUnknown(socketIp);
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded != null && forwarded.trim() !== "") {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const rightmost = hops[hops.length - 1] ?? "";
    const ip = normalizeIp(rightmost);
    if (ip) return ip;
    return socketOrUnknown(socketIp);
  }
  return socketOrUnknown(socketIp);
}

function socketOrUnknown(socketIp?: string | null): string {
  if (!socketIp) return "unknown";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(socketIp.trim());
  if (mapped?.[1]) {
    const v4 = normalizeIp(mapped[1]);
    if (v4) return v4;
  }
  return normalizeIp(socketIp.trim()) ?? "unknown";
}

function normalizeIp(value: string): string | null {
  if (IPV4.test(value)) {
    const parts = value.split(".").map((part) => Number(part));
    if (parts.some((part) => part > 255)) return null;
    return parts.join(".");
  }
  return ipv6Prefix(value);
}

/** First 64 bits, compressed enough to be stable. Null when the text is not an IPv6 address. */
function ipv6Prefix(value: string): string | null {
  if (!value.includes(":") || value.includes(".") || value.includes("%")) return null;
  if ((value.match(/::/g) ?? []).length > 1) return null;
  const compressed = value.includes("::");
  const [head, tail] = compressed ? value.split("::") : [value, undefined];
  const left = head ? head.split(":") : [];
  const right = tail == null ? [] : tail ? tail.split(":") : [];
  if (!compressed && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (compressed && missing < 1) return null;
  const parts = compressed ? [...left, ...Array.from({ length: missing }, () => "0"), ...right] : left;
  if (parts.length !== 8) return null;
  const groups: string[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    groups.push(part.toLowerCase().replace(/^0+/, "") || "0");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
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

  function pruneAll() {
    const cutoff = now() - options.windowMs;
    for (const [candidate, times] of hits) {
      const kept = times.filter((at) => at > cutoff);
      if (kept.length === 0) hits.delete(candidate);
      else if (kept.length !== times.length) hits.set(candidate, kept);
    }
  }

  function windowRetry(): number {
    return Math.max(1, Math.ceil(options.windowMs / 1000));
  }

  /** A new address when the map is already full. An address already stored is not blocked here. */
  function blockedBecauseMapFull(ip: string): number | null {
    if (!hits.has(ip) && hits.size >= maxIps) return windowRetry();
    return null;
  }

  return {
    mapFullRetryAfter(ip: string): number | null {
      pruneAll();
      return blockedBecauseMapFull(ip);
    },
    retryAfterSeconds(ip: string): number | null {
      pruneAll();
      const full = blockedBecauseMapFull(ip);
      if (full != null) return full;
      const kept = hits.get(ip) ?? [];
      if (kept.length < options.limit) return null;
      const oldest = kept[0] ?? now();
      return Math.max(1, Math.ceil((oldest + options.windowMs - now()) / 1000));
    },
    /** Failures still inside the window. An address with zero has not been charged for a bad lookup. */
    count(ip: string): number {
      pruneAll();
      return hits.get(ip)?.length ?? 0;
    },
    record(ip: string) {
      pruneAll();
      if (!hits.has(ip) && hits.size >= maxIps) return;
      const kept = prune(ip);
      kept.push(now());
      hits.set(ip, kept);
    },
  };
}

export type VerifiedBearer = {
  identityId: string;
  identityName: string;
};

/**
 * Hashes that have verified OK, with the identity they verified as.
 * A caller inserts only after a successful verify, so the set cannot grow
 * from forged tokens. It is capped at the identity bound; a full set drops
 * the soonest expiry. Every admitted call still verifies.
 */
export function createVerifiedTokenSet(options: { ttlMs: number; maxSize: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { expiry: number; identityId: string; identityName: string }>();

  function dropExpired(at: number) {
    for (const [hash, entry] of entries) {
      if (entry.expiry <= at) entries.delete(hash);
    }
  }

  return {
    get(hash: string): VerifiedBearer | null {
      const at = now();
      const entry = entries.get(hash);
      if (!entry) return null;
      if (entry.expiry <= at) {
        entries.delete(hash);
        return null;
      }
      return { identityId: entry.identityId, identityName: entry.identityName };
    },
    remember(hash: string, identity: { id: string; name: string }) {
      const at = now();
      dropExpired(at);
      if (!entries.has(hash) && entries.size >= options.maxSize) {
        let oldestHash: string | null = null;
        let oldestExpiry = Number.POSITIVE_INFINITY;
        for (const [candidate, entry] of entries) {
          if (entry.expiry < oldestExpiry) {
            oldestHash = candidate;
            oldestExpiry = entry.expiry;
          }
        }
        if (oldestHash) entries.delete(oldestHash);
      }
      entries.set(hash, {
        expiry: at + options.ttlMs,
        identityId: identity.id,
        identityName: identity.name,
      });
    },
    forget(hash: string) {
      entries.delete(hash);
    },
  };
}

/**
 * Sliding window of calls. The key is an identity id, or one shared key
 * when the limit is process-wide. Retry-After is the time until the oldest
 * call in the window falls out.
 */
export function createCallWindow(options: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 4096;

  function pruneKey(key: string, at: number): number[] {
    const cutoff = at - options.windowMs;
    const kept = (hits.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
    return kept;
  }

  function pruneAll(at: number) {
    for (const key of [...hits.keys()]) pruneKey(key, at);
  }

  /** Drop the quietest other key so a newly seen identity is still limited. */
  function evictOldest(except: string) {
    if (hits.has(except) || hits.size < maxKeys) return;
    let oldestKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [candidate, times] of hits) {
      const last = times[times.length - 1] ?? 0;
      if (last < oldest) {
        oldest = last;
        oldestKey = candidate;
      }
    }
    if (oldestKey) hits.delete(oldestKey);
  }

  return {
    retryAfterSeconds(key: string): number | null {
      const at = now();
      pruneAll(at);
      const kept = hits.get(key) ?? [];
      if (kept.length < options.limit) return null;
      const oldest = kept[0] ?? at;
      return Math.max(1, Math.ceil((oldest + options.windowMs - at) / 1000));
    },
    record(key: string) {
      const at = now();
      pruneAll(at);
      evictOldest(key);
      const kept = pruneKey(key, at);
      if (kept.length >= options.limit) return;
      kept.push(at);
      hits.set(key, kept);
    },
  };
}

/**
 * Hashes refused because the shared lookup bucket was empty. A later
 * presentation of the same hash is a first-verify retry. The set is bounded.
 * When it is full, the oldest hash is dropped so a new one can enter.
 */
export function createWaitingSet(options: { maxSize: number; ttlMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const notedAt = new Map<string, number>();

  function prune(at: number) {
    for (const [hash, noted] of notedAt) {
      if (at >= noted + options.ttlMs) notedAt.delete(hash);
    }
  }

  return {
    has(hash: string): boolean {
      const at = now();
      prune(at);
      return notedAt.has(hash);
    },
    get size(): number {
      prune(now());
      return notedAt.size;
    },
    note(hash: string) {
      const at = now();
      prune(at);
      if (notedAt.has(hash)) {
        notedAt.delete(hash);
        notedAt.set(hash, at);
        return;
      }
      if (notedAt.size >= options.maxSize) {
        const oldest = notedAt.keys().next().value;
        if (oldest) notedAt.delete(oldest);
      }
      notedAt.set(hash, at);
    },
    forget(hash: string) {
      notedAt.delete(hash);
    },
  };
}

/**
 * One bucket for the whole process. It is not keyed by address, so a rotating
 * or spoofed IP cannot mint a new budget. Empty means 429, including before
 * an ads API token lookup.
 */
export function createTokenBucket(options: { capacity: number; refillPerSecond: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  let tokens = options.capacity;
  let updatedAt = now();

  function refill() {
    const at = now();
    const elapsed = Math.max(0, at - updatedAt) / 1000;
    if (options.refillPerSecond > 0) {
      tokens = Math.min(options.capacity, tokens + elapsed * options.refillPerSecond);
    }
    updatedAt = at;
  }

  return {
    retryAfterSeconds(): number {
      refill();
      if (tokens >= 1) return 0;
      if (options.refillPerSecond <= 0) return 60;
      return Math.max(1, Math.ceil((1 - tokens) / options.refillPerSecond));
    },
    /**
     * leave keeps that many tokens. Callers that have not already waited
     * pass leave=1 while a cold hash is waiting, so new fakes cannot spend
     * the token that retry is holding for.
     */
    take(leave = 0): boolean {
      refill();
      if (tokens < 1 + Math.max(0, leave)) return false;
      tokens -= 1;
      return true;
    },
    refund() {
      refill();
      tokens = Math.min(options.capacity, tokens + 1);
    },
  };
}
