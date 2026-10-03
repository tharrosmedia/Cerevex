import { authorizeApprover, authorizeConsole, type AuthGate, type CredentialSource } from './sensitive-auth';

export type ApiAuthClass = 'public' | 'session' | 'approver';

export type ApiInventoryEntry = {
  path: string;
  methods: string[];
  auth: ApiAuthClass;
  /** Auth before this change. */
  currentAuth: string;
  intendedAuth: string;
  p0?: 'B1';
  notes?: string;
};

/**
 * Every Brain `/api` route, plus the ads mutation routes that are not mounted
 * under `/api` but are the approve/apply handlers B1 has to cover.
 * P0 approve/apply rows are first.
 */
export const API_ROUTE_INVENTORY: readonly ApiInventoryEntry[] = [
  {
    path: '/api/approve',
    methods: ['POST'],
    auth: 'approver',
    p0: 'B1',
    currentAuth: 'none — Next route and legacy Hono route both accept any caller',
    intendedAuth:
      'Console session for an allowlisted approver (default Adam) OR x-cerevex-internal-key. Header only. Deny by default.',
    notes: 'Sends approval/decided. Does not call an ads platform mutation.',
  },
  {
    path: '/api/ads/decide',
    methods: ['POST'],
    auth: 'approver',
    p0: 'B1',
    currentAuth: 'Brain APP_PASSWORD cookie when set; open when APP_PASSWORD is unset. Proxies to ads with ADS_INTERNAL_KEY.',
    intendedAuth:
      'Approver console session OR internal key for every action (approve, authorize, deny, snooze). Ads API still lets a signed-in non-approver deny. Kill switch unchanged.',
    notes: 'Whole Brain route is approver-or-internal-key. No query-string key.',
  },
  {
    path: '/recommendations/:id/decide',
    methods: ['POST'],
    auth: 'approver',
    p0: 'B1',
    currentAuth: 'Ads session cookie, bearer JWT, or x-cerevex-internal-key. Approve checks the Adam allowlist.',
    intendedAuth:
      'Same session/internal-key gate. Unauthenticated and wrong keys stay 401. Approver session may pass the auth gate. Kill switch still blocks the write. Not mounted under /api.',
    notes: 'Actions: approve, authorize, deny, snooze. No rollback route exists.',
  },
  {
    path: '/recommendations/:id/apply',
    methods: ['POST'],
    auth: 'approver',
    p0: 'B1',
    currentAuth: 'Ads session, bearer, or internal key, then the Adam allowlist and authorize-to-apply.',
    intendedAuth: 'Unauthenticated and wrong keys stay 401. Approver session reaches the existing gate. Spend behavior unchanged.',
    notes: 'There is no /rollback and no separate authorize-to-apply HTTP route. authorize is the decide action plus this apply gate.',
  },
  {
    path: '/api/login',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'none (compares APP_PASSWORD)',
    intendedAuth: 'Public. This is how a console session is created.',
  },
  {
    path: '/api/inngest',
    methods: ['GET', 'POST', 'PUT'],
    auth: 'public',
    currentAuth: 'Inngest signing key inside the SDK',
    intendedAuth: 'Public webhook. Signature verification stays in the Inngest serve handler (INNGEST_SIGNING_KEY).',
    notes: 'Ads worker also exposes /api/inngest the same way, plus GET /health.',
  },
  {
    path: '/api/gsc/oauth/callback',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'none — state query was the raw store id',
    intendedAuth: 'Public OAuth callback. Signed single-use state binds the initiating session and store. Redirects use PUBLIC_URL.',
  },
  {
    path: '/api/gsc/oauth/start',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'none',
    intendedAuth: 'Console session. Mints the signed state. Not an OAuth callback.',
  },
  {
    path: '/api/ads/pixel',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'none — site token query param',
    intendedAuth: 'Public pixel script. Customer sites load it without a console session.',
  },
  {
    path: '/api/ads/collect',
    methods: ['POST', 'OPTIONS'],
    auth: 'public',
    currentAuth: 'none — funnel collect beacon',
    intendedAuth: 'Public beacon. The ads API records the event; it does not approve or apply.',
  },
  {
    path: '/api/ads/connect',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'consoleAuthorized (APP_PASSWORD)',
    intendedAuth: 'Console session or internal key.',
  },
  {
    path: '/api/ads/checks',
    methods: ['POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized',
    intendedAuth: 'Console session or internal key.',
  },
  {
    path: '/api/ads/sync',
    methods: ['POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized',
    intendedAuth: 'Console session or internal key. Sync is not an approve/apply path.',
  },
  {
    path: '/api/ads/m51',
    methods: ['POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized',
    intendedAuth: 'Console session or internal key.',
  },
  {
    path: '/api/ads/*',
    methods: ['GET', 'POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized on the proxy; decide/apply paths are blocked by the proxy allowlist',
    intendedAuth: 'Console session or internal key. Catch-all proxy. Does not forward approve/apply.',
  },
  {
    path: '/api/wordpress/plugin',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'none at the edge; handler reads the active store cookie',
    intendedAuth: 'Console session or internal key.',
  },
  {
    path: '/api/wordpress/install-note',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'none at the edge',
    intendedAuth: 'Console session or internal key.',
  },
  {
    path: '/api/health',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'no Brain handler',
    intendedAuth: 'Reserved public health check. No handler in this repo (Next returns 404). Ads API /health and /ready are separate and already public.',
  },
  {
    path: '/api/ready',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'no Brain handler',
    intendedAuth: 'Reserved public readiness check. No handler in this repo.',
  },
  {
    path: '/api/webhooks/shopify',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'no handler',
    intendedAuth: 'Reserved public Shopify webhook. No handler yet, so nothing is accepted. A future handler must verify the Shopify HMAC before it reads the body.',
  },
  {
    path: '/api/shopify/webhooks',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'no handler',
    intendedAuth: 'Reserved alias of the Shopify webhook. HMAC required before any handler is added.',
  },
  {
    path: '/api/webhooks/meta',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'no handler',
    intendedAuth: 'Reserved public Meta webhook. Signature verification is required before any handler is added.',
  },
  {
    path: '/api/meta/data-deletion',
    methods: ['GET', 'POST'],
    auth: 'public',
    currentAuth: 'no API handler — operators use the public /data-deletion page',
    intendedAuth: 'Reserved public Meta data-deletion callback. Must stay public. No handler yet.',
  },
  {
    path: '/api/meta/deauthorize',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'no handler',
    intendedAuth: 'Reserved public Meta deauthorize callback.',
  },
];

function normalizePath(pathname: string): string {
  const path = pathname.split('?')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) return path.replace(/\/+$/, '');
  return path;
}

function matches(rulePath: string, pathname: string): boolean {
  if (rulePath.endsWith('/*')) {
    const prefix = rulePath.slice(0, -1);
    return pathname === prefix.slice(0, -1) || pathname.startsWith(prefix);
  }
  return rulePath === pathname;
}

export function classifyApiRoute(pathname: string, method: string): ApiAuthClass | 'deny' {
  const path = normalizePath(pathname);
  const verb = method.toUpperCase();
  if (!path.startsWith('/api')) return 'deny';
  const exact = API_ROUTE_INVENTORY.find((entry) => entry.path === path && entry.methods.includes(verb));
  if (exact) return exact.auth;
  const wildcard = API_ROUTE_INVENTORY.find(
    (entry) => entry.path.endsWith('/*') && entry.methods.includes(verb) && matches(entry.path, path),
  );
  if (wildcard) return wildcard.auth;
  // Deny-by-default: an unknown /api route still needs a session or internal key.
  return 'session';
}

export type ApiGuard =
  | { kind: 'public' }
  | { kind: 'allow'; via: 'session' | 'internal' | 'dev-open' }
  | { kind: 'deny'; status: 401 | 403; error: string };

export function guardApi(pathname: string, method: string, creds: CredentialSource): ApiGuard {
  const auth = classifyApiRoute(pathname, method);
  if (auth === 'public') return { kind: 'public' };
  const gate: AuthGate = auth === 'approver' ? authorizeApprover(creds) : authorizeConsole(creds);
  if (!gate.ok) return { kind: 'deny', status: gate.status, error: gate.error };
  return { kind: 'allow', via: gate.via };
}
