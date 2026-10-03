export const ADS_COLLECT_MAX_BODY_BYTES = 32 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

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

export function adsCollectClientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'unknown';
}

export function allowAdsCollect(ip: string, now = Date.now()): boolean {
  const row = buckets.get(ip);
  if (!row || now >= row.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (row.count >= MAX_REQUESTS) return false;
  row.count += 1;
  return true;
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
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > ADS_COLLECT_MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload too large', origin: allowed };
  }
  const text = await request.text();
  if (text.length > ADS_COLLECT_MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload too large', origin: allowed };
  }
  if (!text.trim()) return { ok: false, status: 400, error: 'bad request', origin: allowed };
  try {
    return { ok: true, origin: allowed, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'bad request', origin: allowed };
  }
}
