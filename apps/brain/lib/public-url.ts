type HeaderReader = { get(name: string): string | null };

type RequestLike = {
  url?: string;
  headers?: HeaderReader;
};

function firstHeaderValue(value: string | null | undefined): string {
  return (value || '').split(',')[0].trim();
}

function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(1, end).toLowerCase() : host.toLowerCase();
  }
  return host.split(':')[0].toLowerCase();
}

function isLoopbackHost(host: string): boolean {
  const hostname = hostnameOf(host);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function originFromEnv(): string {
  const raw = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    try {
      return new URL(`https://${raw}`).origin;
    } catch {
      return '';
    }
  }
}

function originFromForwardedHeaders(headers?: HeaderReader): string {
  if (!headers) return '';
  const host = firstHeaderValue(headers.get('x-forwarded-host') || headers.get('host'));
  if (!host || isLoopbackHost(host)) return '';
  const proto = firstHeaderValue(headers.get('x-forwarded-proto')) || 'https';
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return '';
  }
}

function originFromRequestUrl(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Public site origin for operator redirects. Never use the container listen URL first. */
export function publicOrigin(req?: RequestLike): string {
  return originFromEnv() || originFromForwardedHeaders(req?.headers) || originFromRequestUrl(req?.url);
}

/** Absolute URL on the public site (PUBLIC_URL / forwarded host), not Railway's localhost bind. */
export function publicRedirect(path: string, req?: RequestLike): URL {
  const origin = publicOrigin(req);
  if (origin) return new URL(path, `${origin}/`);
  if (req?.url) return new URL(path, req.url);
  throw new Error('Cannot build public redirect: PUBLIC_URL is unset and request URL is missing');
}
