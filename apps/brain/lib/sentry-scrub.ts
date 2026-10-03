const SENSITIVE_FIELD = /token|secret|password|key|authorization/i;
const SENSITIVE_QUERY = /token|secret|password|key|authorization|^code$|^state$|^email$/i;
const SHOPIFY_TOKEN = /\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+\b/g;
const GOOGLE_ACCESS_TOKEN = /\bya29\.[A-Za-z0-9._-]+\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ENCODED_EMAIL = /[A-Za-z0-9._%+-]+%40[A-Za-z0-9.-]+(?:\.[A-Za-z]{2,}|%2[Ee][A-Za-z]{2,})/g;
const EMBEDDED_URL = /https?:\/\/[^\s"'<>]+/gi;
const INLINE_SECRET = /(^|[^A-Za-z0-9_])((?:refresh_token|access_token|client_secret|id_token|token|password|secret|code|state|email|key)=)([^&\s"'<>#]*)/gi;
const INLINE_SECRET_ENCODED = /(^|[^A-Za-z0-9_]|%3[Ff]|%26)((?:refresh_token|access_token|client_secret|id_token|token|password|secret|code|state|email|key)%3[Dd])([^%&\s"'<>#]*)/gi;
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

function secretVariants(secret: string): string[] {
  const encoded = encodeURIComponent(secret);
  const form = encoded.replace(/%20/g, '+');
  const variants = [secret, secret.toLowerCase(), encoded, encoded.toLowerCase(), form, form.toLowerCase()];
  return variants.filter((variant, index) => variant.length >= 4 && variants.indexOf(variant) === index);
}

function scrubConfiguredSecrets(value: string): string {
  const variants: string[] = [];
  for (const name of SECRET_ENV_NAMES) {
    const secret = process.env[name];
    if (!secret || secret.length < 4) continue;
    variants.push(...secretVariants(secret));
  }
  variants.sort((a, b) => b.length - a.length);
  let out = value;
  const seen = new Set<string>();
  for (const variant of variants) {
    if (seen.has(variant)) continue;
    seen.add(variant);
    if (out.includes(variant)) out = out.split(variant).join(REDACTED);
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
    const rendered = absolute ? url.toString() : `${url.pathname}${url.search}`;
    return scrubLoose(rendered);
  } catch {
    return scrubLoose(value);
  }
}

/** Query values first, then free-text scrub of the host and path. Transaction names keep their prefix. */
function scrubUrlField(value: string): string {
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) return scrubUrl(value);
  const queryAt = value.indexOf('?');
  if (queryAt === -1) return scrubLoose(value);
  const head = value.slice(0, queryAt);
  const query = value.slice(queryAt + 1);
  try {
    const url = new URL(`http://sentry.invalid/?${query}`);
    for (const key of [...url.searchParams.keys()]) {
      const current = url.searchParams.get(key) ?? '';
      url.searchParams.set(key, isSensitiveQuery(key) ? REDACTED : scrubLoose(current));
    }
    const search = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    return scrubLoose(`${head}?${search}`);
  } catch {
    return scrubLoose(value);
  }
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

function safeObjectKey(key: string): string {
  return scrubLoose(key);
}

/**
 * Keep Client, Scope, and other live SDK objects so the envelope trace header survives.
 * Plain objects are copied and scrubbed. Cycles are cut.
 */
function scrubMetadata(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return scrubLoose(value);
  if (!value || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return isPlainObject(value) || Array.isArray(value) ? REDACTED : value;
  if (seen.has(value)) return REDACTED;
  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => scrubMetadata(item, seen, depth + 1));
  }
  if (!isPlainObject(value)) return value;
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    const key = safeObjectKey(childKey);
    if (isSensitiveHeader(childKey) || SENSITIVE_FIELD.test(childKey)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = scrubMetadata(child, seen, depth + 1);
  }
  return out;
}

function scrubUnknown(value: unknown, key?: string, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (key === 'sdkProcessingMetadata') return scrubMetadata(value, seen, depth + 1);
  if (key && (isSensitiveHeader(key) || SENSITIVE_FIELD.test(key))) return REDACTED;
  if (key === 'cookies' && value && typeof value === 'object' && !Array.isArray(value) && isPlainObject(value)) {
    return scrubCookieBag(value as Record<string, unknown>);
  }
  if (key && isQueryKey(key)) return scrubQuery(value, seen, depth);
  if (key && URL_FIELDS.has(key) && typeof value === 'string') {
    return scrubUrlField(value);
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
      out[safeObjectKey(childKey)] = scrubUnknown(child, childKey, seen, depth + 1);
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
    beforeSendSpan(span: any): any {
      return safeScrubSentryEvent(span);
    },
  };
}
