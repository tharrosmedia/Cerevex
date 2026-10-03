const SENSITIVE_FIELD = /token|secret|password|key|authorization/i;
const SENSITIVE_QUERY = /token|secret|password|key|authorization|^code$|^state$/i;
const SHOPIFY_TOKEN = /\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+\b/g;
const GOOGLE_ACCESS_TOKEN = /\bya29\.[A-Za-z0-9._-]+\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const REDACTED = '[redacted]';

/** Cookie names that are safe to keep. Everything else, including auth and tharros_session, is redacted. */
const HARMLESS_COOKIES = new Set(['locale', 'theme']);

const URL_FIELDS = new Set(['url', 'transaction', 'description']);

function isSensitiveHeader(name: string): boolean {
  const header = name.toLowerCase();
  if (header === 'authorization' || header === 'cookie' || header === 'set-cookie') return true;
  if (header === 'x-api-key') return true;
  return /^x-.+-key$/.test(header);
}

function scrubTokens(value: string): string {
  let out = value;
  const internal = process.env.ADS_INTERNAL_KEY;
  if (internal && internal.length >= 8 && out.includes(internal)) {
    out = out.split(internal).join(REDACTED);
  }
  out = out.replace(SHOPIFY_TOKEN, REDACTED);
  out = out.replace(GOOGLE_ACCESS_TOKEN, REDACTED);
  out = out.replace(JWT, REDACTED);
  return out;
}

function scrubEmails(value: string): string {
  return value.replace(EMAIL, REDACTED);
}

function isSensitiveQuery(name: string): boolean {
  return SENSITIVE_QUERY.test(name);
}

function scrubUrl(value: string): string {
  try {
    const absolute = /^https?:\/\//i.test(value);
    const url = new URL(value, 'http://sentry.invalid');
    for (const key of [...url.searchParams.keys()]) {
      const current = url.searchParams.get(key) ?? '';
      url.searchParams.set(key, isSensitiveQuery(key) ? REDACTED : scrubEmails(scrubTokens(current)));
    }
    url.hash = '';
    if (absolute) return url.toString();
    return `${url.pathname}${url.search}`;
  } catch {
    return scrubEmails(scrubTokens(value));
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || (value.startsWith('/') && value.includes('?'));
}

function tryScrubJson(value: string): string | null {
  const trimmed = value.trim();
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return null;
  }
  try {
    return JSON.stringify(scrubUnknown(JSON.parse(trimmed)));
  } catch {
    return null;
  }
}

function scrubText(value: string): string {
  const json = tryScrubJson(value);
  if (json != null) return json;
  const withUrl = looksLikeUrl(value) ? scrubUrl(value) : value;
  return scrubEmails(scrubTokens(withUrl));
}

function scrubCookieBag(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, cookie] of Object.entries(value)) {
    out[name] = HARMLESS_COOKIES.has(name) ? cookie : REDACTED;
  }
  return out;
}

function scrubQuery(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.includes('=')) return scrubUrl(`/?${value.replace(/^\?/, '')}`).replace(/^\//, '');
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (Array.isArray(entry) && typeof entry[0] === 'string') {
        return [entry[0], isSensitiveQuery(entry[0]) ? REDACTED : scrubText(String(entry[1] ?? ''))];
      }
      return scrubUnknown(entry);
    });
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveQuery(key) ? REDACTED : scrubUnknown(child);
    }
    return out;
  }
  return value;
}

function scrubUnknown(value: unknown, key?: string): unknown {
  if (key && (isSensitiveHeader(key) || SENSITIVE_FIELD.test(key))) return REDACTED;
  if (key === 'cookies' && value && typeof value === 'object' && !Array.isArray(value)) {
    return scrubCookieBag(value as Record<string, unknown>);
  }
  if (key === 'query_string') return scrubQuery(value);
  if (key && URL_FIELDS.has(key) && typeof value === 'string') return looksLikeUrl(value) || value.includes('?') ? scrubUrl(value) : scrubText(value);
  if (typeof value === 'string') return scrubText(value);
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

/** Strip secrets from a Sentry event or transaction (request, extra, contexts, breadcrumbs, exceptions). */
export function scrubSentryEvent<T>(event: T): T {
  return scrubUnknown(event) as T;
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T): T {
  return scrubUnknown(breadcrumb) as T;
}
