const SENSITIVE_FIELD = /token|secret|password|key|authorization/i;
const SENSITIVE_QUERY = /token|secret|password|key|authorization|^code$|^state$|^email$/i;
const SHOPIFY_TOKEN = /\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+\b/g;
const GOOGLE_ACCESS_TOKEN = /\bya29\.[A-Za-z0-9._-]+\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ENCODED_EMAIL = /[A-Za-z0-9._%+-]+%40[A-Za-z0-9.-]+(?:\.[A-Za-z]{2,}|%2[Ee][A-Za-z]{2,})/g;
const EMBEDDED_URL = /https?:\/\/[^\s"'<>]+/gi;
const INLINE_SECRET = /(^|[^A-Za-z0-9_])((?:refresh_token|access_token|client_secret|id_token|token|password|secret|code|state|email|key)=)([^&\s"'<>#]*)/gi;
const INLINE_SECRET_ENCODED = /(^|[^A-Za-z0-9_])((?:refresh_token|access_token|client_secret|id_token|token|password|secret|code|state|email|key)%3[Dd])([^&\s"'<>#%]*)/gi;
const REDACTED = '[redacted]';
const MAX_DEPTH = 12;

/** Cookie names that are safe to keep. Everything else, including auth and tharros_session, is redacted. */
const HARMLESS_COOKIES = new Set(['locale', 'theme']);

/** Values of these env vars are stripped from free text. Shorter than 4 characters is ignored so a tiny value cannot blank every string. */
const SECRET_ENV_NAMES = ['APP_PASSWORD', 'ADS_INTERNAL_KEY', 'ENCRYPTION_KEY', 'GSC_OAUTH_STATE_SECRET'] as const;

const URL_FIELDS = new Set(['url', 'transaction', 'description']);

function isSensitiveHeader(name: string): boolean {
  const header = name.toLowerCase();
  if (header === 'authorization' || header === 'cookie' || header === 'set-cookie') return true;
  if (header === 'x-api-key') return true;
  return /^x-.+-key$/.test(header);
}

function isQueryKey(name: string): boolean {
  const key = name.toLowerCase();
  return key === 'query_string' || key === 'query' || key === 'fragment' || key.endsWith('.query') || key.endsWith('.fragment');
}

function scrubConfiguredSecrets(value: string): string {
  let out = value;
  for (const name of SECRET_ENV_NAMES) {
    const secret = process.env[name];
    if (!secret || secret.length < 4) continue;
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && encoded.length >= 4 && out.includes(encoded)) out = out.split(encoded).join(REDACTED);
  }
  return out;
}

function scrubInlineSecrets(value: string): string {
  return value
    .replace(INLINE_SECRET, (_match, prefix: string, key: string) => `${prefix}${key}${REDACTED}`)
    .replace(INLINE_SECRET_ENCODED, (_match, prefix: string, key: string) => `${prefix}${key}${REDACTED}`);
}

function scrubTokens(value: string): string {
  let out = scrubConfiguredSecrets(value);
  out = out.replace(SHOPIFY_TOKEN, REDACTED);
  out = out.replace(GOOGLE_ACCESS_TOKEN, REDACTED);
  out = out.replace(JWT, REDACTED);
  return out;
}

function scrubEmails(value: string): string {
  return value.replace(EMAIL, REDACTED).replace(ENCODED_EMAIL, REDACTED);
}

function scrubLoose(value: string): string {
  return scrubEmails(scrubInlineSecrets(scrubTokens(value)));
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
      url.searchParams.set(key, isSensitiveQuery(key) ? REDACTED : scrubLoose(current));
    }
    url.hash = '';
    if (absolute) return url.toString();
    return `${url.pathname}${url.search}`;
  } catch {
    return scrubLoose(value);
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || (value.startsWith('/') && value.includes('?'));
}

function scrubText(value: string, seen: WeakSet<object>, depth: number): string {
  const json = tryScrubJson(value, seen, depth);
  if (json != null) return json;
  const withUrls = value.replace(EMBEDDED_URL, (url) => scrubUrl(url));
  return scrubLoose(withUrls);
}

function tryScrubJson(value: string, seen: WeakSet<object>, depth: number): string | null {
  const trimmed = value.trim();
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return null;
  }
  try {
    return JSON.stringify(scrubUnknown(JSON.parse(trimmed), undefined, seen, depth + 1));
  } catch {
    return null;
  }
}

function scrubCookieBag(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, cookie] of Object.entries(value)) {
    out[name] = HARMLESS_COOKIES.has(name) ? cookie : REDACTED;
  }
  return out;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function scrubQuery(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') {
    if (value.includes('=') || value.includes('%3D') || value.includes('%3d')) {
      const normalized = value.replace(/%3[Dd]/g, '=').replace(/^\?/, '');
      return scrubUrl(`/?${normalized}`).replace(/^\//, '');
    }
    return scrubText(value, seen, depth);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (Array.isArray(entry) && typeof entry[0] === 'string') {
        return [entry[0], isSensitiveQuery(entry[0]) ? REDACTED : scrubUnknown(entry[1], undefined, seen, depth + 1)];
      }
      return scrubUnknown(entry, undefined, seen, depth + 1);
    });
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveQuery(key) ? REDACTED : scrubUnknown(child, key, seen, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubUnknown(value: unknown, key?: string, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (key === 'sdkProcessingMetadata') return undefined;
  if (key && (isSensitiveHeader(key) || SENSITIVE_FIELD.test(key))) return REDACTED;
  if (key === 'cookies' && value && typeof value === 'object' && !Array.isArray(value) && isPlainObject(value)) {
    return scrubCookieBag(value as Record<string, unknown>);
  }
  if (key && isQueryKey(key)) return scrubQuery(value, seen, depth);
  if (key && URL_FIELDS.has(key) && typeof value === 'string') {
    return looksLikeUrl(value) || value.includes('?') ? scrubUrl(value) : scrubText(value, seen, depth);
  }
  if (typeof value === 'string') return scrubText(value, seen, depth);
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => scrubUnknown(item, undefined, seen, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (!isPlainObject(value)) return REDACTED;
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (childKey === 'sdkProcessingMetadata') continue;
      out[childKey] = scrubUnknown(child, childKey, seen, depth + 1);
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

/** Never throw into the SDK. A scrub failure drops the event or breadcrumb. */
export function safeScrubSentryEvent<T>(event: T): T | null {
  try {
    return scrubSentryEvent(event);
  } catch (error) {
    console.error('[sentry] scrub failed; dropping event', error instanceof Error ? error.name : 'error');
    return null;
  }
}

export function safeScrubSentryBreadcrumb<T>(breadcrumb: T): T | null {
  try {
    return scrubSentryBreadcrumb(breadcrumb);
  } catch (error) {
    console.error('[sentry] breadcrumb scrub failed; dropping breadcrumb', error instanceof Error ? error.name : 'error');
    return null;
  }
}

/**
 * Hooks for Sentry.init. Parameters stay untyped so this module does not import a second
 * copy of @sentry/core (Next bundles its own, and the two copies are not assignable).
 */
export function sentryScrubHooks() {
  return {
    beforeSend(event: any): any {
      return safeScrubSentryEvent(event);
    },
    beforeSendTransaction(event: any): any {
      return safeScrubSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb: any): any {
      return safeScrubSentryBreadcrumb(breadcrumb);
    },
    beforeSendLog(log: any): any {
      return safeScrubSentryEvent(log);
    },
  };
}
