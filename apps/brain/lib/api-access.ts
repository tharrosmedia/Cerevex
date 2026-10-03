import { authorizeApproveSession, authorizeApprover, authorizeConsole, type AuthGate, type CredentialSource } from './sensitive-auth';

export type ApiAuthClass = 'public' | 'session' | 'approver' | 'approve-session';

export type ApiSurface = 'brain' | 'ads-api' | 'ads-worker';

export type ApiInventoryEntry = {
  surface: ApiSurface;
  path: string;
  methods: string[];
  auth: ApiAuthClass;
  /** Auth before this change. */
  currentAuth: string;
  intendedAuth: string;
  p0?: 'B1';
  notes?: string;
  /** Repo file that must contain `marker` for a documented public route. */
  source?: string;
  marker?: string;
};

/**
 * Every Brain `/api` route, plus the ads mutation routes that are not mounted
 * under `/api` but are the approve/apply handlers B1 has to cover.
 * P0 approve/apply rows are first.
 */
export const API_ROUTE_INVENTORY: readonly ApiInventoryEntry[] = [
  {
    surface: 'brain',
    path: '/api/approve',
    methods: ['POST'],
    auth: 'approve-session',
    p0: 'B1',
    currentAuth: 'none — Next route and legacy Hono route both accept any caller',
    intendedAuth:
      'Console session for an allowlisted approver (default Adam). The internal service key is not an approval. Header-only keys and anonymous callers are 401 and write nothing.',
    notes: 'Sends approval/decided. Does not call an ads platform mutation.',
  },
  {
    surface: 'brain',
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
    surface: 'ads-api',
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
    surface: 'ads-api',
    path: '/recommendations/:id/apply',
    methods: ['POST'],
    auth: 'approver',
    p0: 'B1',
    currentAuth: 'Ads session, bearer, or internal key, then the Adam allowlist and authorize-to-apply.',
    intendedAuth: 'Unauthenticated and wrong keys stay 401. Approver session reaches the existing gate. Spend behavior unchanged.',
    notes: 'There is no /rollback and no separate authorize-to-apply HTTP route. authorize is the decide action plus this apply gate.',
  },
  {
    surface: 'brain',
    path: '/api/login',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'none (compares APP_PASSWORD)',
    intendedAuth: 'Public. This is how a console session is created.',
  },
  {
    surface: 'brain',
    path: '/api/inngest',
    methods: ['GET', 'POST', 'PUT'],
    auth: 'public',
    currentAuth: 'Inngest signing key inside the SDK',
    intendedAuth: 'Public webhook. Signature verification stays in the Inngest serve handler (INNGEST_SIGNING_KEY).',
    notes: 'Ads worker also exposes /api/inngest the same way, plus GET /health.',
  },
  {
    surface: 'brain',
    path: '/api/gsc/oauth/callback',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'none — state query was the raw store id',
    intendedAuth: 'Public OAuth callback. Signed single-use state is bound to a random httpOnly sid, not the console password. Redirects use PUBLIC_URL.',
  },
  {
    surface: 'brain',
    path: '/api/gsc/oauth/start',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'none',
    intendedAuth: 'Middleware and handler both use authorizeConsole (session or internal key). The state bind is an HMAC of a random sid, not APP_PASSWORD.',
  },
  {
    surface: 'brain',
    path: '/api/ads/pixel',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'none — site token query param',
    intendedAuth: 'Public pixel script. Customer sites load it without a console session.',
  },
  {
    surface: 'brain',
    path: '/api/ads/collect',
    methods: ['POST', 'OPTIONS'],
    auth: 'public',
    currentAuth: 'none — funnel collect beacon, CORS *, no body cap',
    intendedAuth: 'Public beacon. 32KB body cap, per-IP rate limit, CORS allowlist from ADS_COLLECT_ORIGINS. Generic errors. Does not approve or apply.',
  },
  {
    surface: 'brain',
    path: '/api/ads/connect',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'consoleAuthorized (APP_PASSWORD cookie only)',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler calls consoleAuthorized(), which accepts the APP_PASSWORD cookie only and does not accept the internal key.',
  },
  {
    surface: 'brain',
    path: '/api/ads/checks',
    methods: ['POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized (APP_PASSWORD cookie only)',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler calls consoleAuthorized(), which accepts the APP_PASSWORD cookie only and does not accept the internal key.',
  },
  {
    surface: 'brain',
    path: '/api/ads/sync',
    methods: ['POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized (APP_PASSWORD cookie only)',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler calls consoleAuthorized(), which accepts the APP_PASSWORD cookie only and does not accept the internal key. Sync is not an approve/apply path.',
  },
  {
    surface: 'brain',
    path: '/api/ads/m51',
    methods: ['POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized (APP_PASSWORD cookie only)',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler calls consoleAuthorized(), which accepts the APP_PASSWORD cookie only and does not accept the internal key.',
  },
  {
    surface: 'brain',
    path: '/api/ads/*',
    methods: ['GET', 'POST'],
    auth: 'session',
    currentAuth: 'consoleAuthorized on the proxy; decide/apply paths are blocked by the proxy allowlist',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler calls consoleAuthorized(), which accepts the APP_PASSWORD cookie only and does not accept the internal key. Catch-all proxy. Does not forward approve/apply.',
  },
  {
    surface: 'brain',
    path: '/api/wordpress/plugin',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'none at the edge; handler reads the active store cookie',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler does not call consoleAuthorized().',
  },
  {
    surface: 'brain',
    path: '/api/wordpress/install-note',
    methods: ['GET'],
    auth: 'session',
    currentAuth: 'none at the edge',
    intendedAuth: 'Middleware allows a console session or the internal key. The handler does not call consoleAuthorized().',
  },
  {
    surface: 'brain',
    path: '/api/health',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'no Brain handler',
    intendedAuth: 'Public. In production, 503 when ENCRYPTION_KEY, GSC_OAUTH_STATE_SECRET, APP_PASSWORD, or ADS_INTERNAL_KEY is missing or ENCRYPTION_KEY has stray whitespace. Railway healthcheck path after merge.',
  },
];

/** Ads processes. Not Brain middleware routes, so guardApi does not treat them as public Brain paths. */
export const ADS_PUBLIC_ROUTE_INVENTORY: readonly ApiInventoryEntry[] = [
  {
    surface: 'ads-api',
    path: '/health',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'public',
    intendedAuth: 'Public ads API liveness.',
    source: 'apps/ads/api/src/app.ts',
    marker: 'app.get("/health"',
  },
  {
    surface: 'ads-api',
    path: '/ready',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'public',
    intendedAuth: 'Public ads API readiness.',
    source: 'apps/ads/api/src/app.ts',
    marker: 'app.get("/ready"',
  },
  {
    surface: 'ads-api',
    path: '/auth/login',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'public password check',
    intendedAuth: 'Public login. Creates the ads session.',
    source: 'apps/ads/api/src/app.ts',
    marker: 'app.post("/auth/login"',
  },
  {
    surface: 'ads-api',
    path: '/auth/logout',
    methods: ['POST'],
    auth: 'public',
    currentAuth: 'public',
    intendedAuth: 'Public logout.',
    source: 'apps/ads/api/src/app.ts',
    marker: 'app.post("/auth/logout"',
  },
  {
    surface: 'ads-api',
    path: '/oauth/:platform/callback',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'public OAuth callback',
    intendedAuth: 'Public OAuth callback.',
    source: 'apps/ads/api/src/routes.ts',
    marker: 'app.get("/oauth/:platform/callback"',
  },
  {
    surface: 'ads-api',
    path: '/funnel/pixel.js',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'public pixel',
    intendedAuth: 'Public pixel script.',
    source: 'apps/ads/api/src/m51.ts',
    marker: 'app.get("/funnel/pixel.js"',
  },
  {
    surface: 'ads-api',
    path: '/funnel/collect',
    methods: ['POST', 'OPTIONS'],
    auth: 'public',
    currentAuth: 'public collect',
    intendedAuth: 'Public funnel collect. Writes os.funnel_events only.',
    source: 'apps/ads/api/src/m51.ts',
    marker: 'app.post("/funnel/collect"',
  },
  {
    surface: 'ads-worker',
    path: '/health',
    methods: ['GET'],
    auth: 'public',
    currentAuth: 'public',
    intendedAuth: 'Public worker liveness.',
    source: 'apps/ads/workers/src/index.ts',
    marker: 'app.get("/health"',
  },
  {
    surface: 'ads-worker',
    path: '/api/inngest',
    methods: ['GET', 'POST', 'PUT'],
    auth: 'public',
    currentAuth: 'Inngest signing key',
    intendedAuth: 'Public worker Inngest endpoint. Signature verification stays in the SDK.',
    source: 'apps/ads/workers/src/index.ts',
    marker: '"/api/inngest"',
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
  const brainRoutes = API_ROUTE_INVENTORY.filter((entry) => entry.surface === 'brain');
  const exact = brainRoutes.find((entry) => entry.path === path && entry.methods.includes(verb));
  if (exact) return exact.auth;
  const wildcard = brainRoutes.find(
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
  const gate: AuthGate = auth === 'approve-session'
    ? authorizeApproveSession(creds)
    : auth === 'approver'
      ? authorizeApprover(creds)
      : authorizeConsole(creds);
  if (!gate.ok) return { kind: 'deny', status: gate.status, error: gate.error };
  return { kind: 'allow', via: gate.via };
}
