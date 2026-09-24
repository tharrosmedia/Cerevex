import { createHmac, timingSafeEqual } from "node:crypto";

export const CEREVEX_TIMESTAMP_HEADER = "x-cerevex-timestamp";
export const CEREVEX_SIGNATURE_HEADER = "x-cerevex-signature";
export const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export function normalizeSiteUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export function pluginRestPath(siteUrl: string, path: string): string {
  const base = normalizeSiteUrl(siteUrl);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}/wp-json/cerevex/v1${suffix}`;
}

export function canonicalSignedPayload(input: {
  timestamp: string;
  method: string;
  path: string;
  body: string;
}): string {
  return `${input.timestamp}\n${input.method.toUpperCase()}\n${input.path}\n${input.body}`;
}

export function signRequest(input: {
  pluginKey: string;
  method: string;
  path: string;
  body?: string;
  timestamp?: string;
}): { timestamp: string; signature: string; headers: Record<string, string> } {
  const timestamp = input.timestamp || String(Date.now());
  const body = input.body ?? "";
  const payload = canonicalSignedPayload({
    timestamp,
    method: input.method,
    path: input.path,
    body,
  });
  const signature = createHmac("sha256", input.pluginKey).update(payload).digest("hex");
  return {
    timestamp,
    signature,
    headers: {
      [CEREVEX_TIMESTAMP_HEADER]: timestamp,
      [CEREVEX_SIGNATURE_HEADER]: signature,
      "content-type": "application/json",
    },
  };
}

export function verifySignature(input: {
  pluginKey: string;
  method: string;
  path: string;
  body: string;
  timestamp: string;
  signature: string;
  nowMs?: number;
}): { ok: boolean; reason?: "unsigned" | "bad_auth" } {
  if (!input.pluginKey || !input.timestamp || !input.signature) {
    return { ok: false, reason: "unsigned" };
  }
  const now = input.nowMs ?? Date.now();
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_MAX_SKEW_MS) {
    return { ok: false, reason: "bad_auth" };
  }
  const expected = signRequest({
    pluginKey: input.pluginKey,
    method: input.method,
    path: input.path,
    body: input.body,
    timestamp: input.timestamp,
  }).signature;
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(input.signature, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "bad_auth" };
    }
  } catch {
    return { ok: false, reason: "bad_auth" };
  }
  return { ok: true };
}
