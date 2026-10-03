export const ADS_COLLECT_MAX_BODY_BYTES = 32 * 1024;
export const ADS_COLLECT_WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
export const ADS_COLLECT_MAX_BUCKETS = 1024;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function resetAdsCollectLimits(): void {
  buckets.clear();
}

export function adsCollectOrigins(): string[] {
  return (process.env.ADS_COLLECT_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Matching Origin, or null when the request is not a listed browser origin. Never '*'. */
export function adsCollectAllowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return adsCollectOrigins().includes(origin) ? origin : null;
}

export function adsCollectCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = adsCollectAllowOrigin(origin);
  if (!allowed) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

/**
 * Railway appends the connecting address. The leftmost hop is client-controlled, so the limit uses the rightmost hop.
 */
export function adsCollectClientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  const hops = forwarded?.split(',').map((hop) => hop.trim()).filter(Boolean) ?? [];
  const trusted = hops.length ? hops[hops.length - 1] : '';
  return trusted || headers.get('x-real-ip')?.trim() || 'unknown';
}

function evictBuckets(now: number): void {
  for (const [ip, row] of buckets) {
    if (row.resetAt <= now) buckets.delete(ip);
  }
  while (buckets.size > ADS_COLLECT_MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function adsCollectBucketCount(): number {
  return buckets.size;
}

export function allowAdsCollect(ip: string, now = Date.now()): boolean {
  evictBuckets(now);
  const row = buckets.get(ip);
  if (!row || now >= row.resetAt) {
    if (buckets.size >= ADS_COLLECT_MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    buckets.set(ip, { count: 1, resetAt: now + ADS_COLLECT_WINDOW_MS });
    return true;
  }
  if (row.count >= MAX_REQUESTS) return false;
  row.count += 1;
  buckets.delete(ip);
  buckets.set(ip, row);
  return true;
}

async function readCappedBody(request: Request): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > ADS_COLLECT_MAX_BODY_BYTES) return { ok: false };
  if (!request.body) {
    const text = await request.text();
    return text.length > ADS_COLLECT_MAX_BODY_BYTES ? { ok: false } : { ok: true, text };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > ADS_COLLECT_MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export type CollectInspection =
  | { ok: true; origin: string | null; body: unknown }
  | { ok: false; status: 400 | 403 | 413 | 429; error: string; origin: string | null };

export async function inspectAdsCollectRequest(request: Request, now = Date.now()): Promise<CollectInspection> {
  const origin = request.headers.get('origin');
  const allowed = adsCollectAllowOrigin(origin);
  if (origin && !allowed) {
    return { ok: false, status: 403, error: 'forbidden', origin: null };
  }
  const ip = adsCollectClientKey(request.headers);
  if (!allowAdsCollect(ip, now)) {
    return { ok: false, status: 429, error: 'too many requests', origin: allowed };
  }
  const body = await readCappedBody(request);
  if (!body.ok) return { ok: false, status: 413, error: 'payload too large', origin: allowed };
  const text = body.text;
  if (!text.trim()) return { ok: false, status: 400, error: 'bad request', origin: allowed };
  try {
    return { ok: true, origin: allowed, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'bad request', origin: allowed };
  }
}
