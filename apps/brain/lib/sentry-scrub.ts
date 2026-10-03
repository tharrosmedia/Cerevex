const SENSITIVE_FIELD = /token|secret|password|key|authorization/i;
const SHOPIFY_TOKEN = /\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+\b/g;
const GOOGLE_ACCESS_TOKEN = /\bya29\.[A-Za-z0-9._-]+\b/g;
const REDACTED = '[redacted]';

function isSensitiveHeader(name: string): boolean {
  const header = name.toLowerCase();
  if (header === 'authorization' || header === 'cookie' || header === 'set-cookie') return true;
  if (header === 'x-api-key') return true;
  return /^x-.+-key$/.test(header);
}

function scrubString(value: string): string {
  let out = value;
  const internal = process.env.ADS_INTERNAL_KEY;
  if (internal && internal.length >= 8 && out.includes(internal)) {
    out = out.split(internal).join(REDACTED);
  }
  out = out.replace(SHOPIFY_TOKEN, REDACTED);
  out = out.replace(GOOGLE_ACCESS_TOKEN, REDACTED);
  return out;
}

function scrubUnknown(value: unknown, key?: string): unknown {
  if (key && (isSensitiveHeader(key) || SENSITIVE_FIELD.test(key))) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubUnknown(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = scrubUnknown(child, childKey);
    }
    return out;
  }
  return value;
}

/** Strip secrets from a Sentry event (request, extra, contexts, breadcrumbs). */
export function scrubSentryEvent<T>(event: T): T {
  return scrubUnknown(event) as T;
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T): T {
  return scrubUnknown(breadcrumb) as T;
}
