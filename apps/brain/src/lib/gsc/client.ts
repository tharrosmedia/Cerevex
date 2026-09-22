import { getStore, updateStore } from '../db/stores';
import { encrypt, decrypt } from '../encryption';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_API = 'https://www.googleapis.com/webmasters/v3';

function getEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isGscConfigured() {
  return !!getEnv();
}

export function buildAuthUrl(storeId: string) {
  const env = getEnv();
  if (!env) throw new Error('GSC not configured on host');
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: storeId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  const env = getEnv();
  if (!env) throw new Error('GSC not configured');
  const body = new URLSearchParams({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) throw new Error('Token exchange failed: ' + await res.text());
  return await res.json();
}

export async function refreshAccessToken(refreshToken: string) {
  const env = getEnv();
  if (!env) throw new Error('GSC not configured');
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) throw new Error('Refresh failed: ' + await res.text());
  return await res.json();
}

export function mapGscPageToResource(pageUrl: string): { resourceType: 'collection'|'page'|'article' | null; handle: string | null } {
  try {
    const u = new URL(pageUrl);
    const p = u.pathname.replace(/\/$/, '');
    if (p.startsWith('/collections/')) return { resourceType: 'collection', handle: p.split('/collections/')[1] || null };
    if (p.startsWith('/pages/')) return { resourceType: 'page', handle: p.split('/pages/')[1] || null };
    if (p.startsWith('/blogs/')) {
      const parts = p.split('/');
      return { resourceType: 'article', handle: parts[parts.length-1] || null };
    }
    return { resourceType: null, handle: null };
  } catch { return { resourceType: null, handle: null }; }
}

export async function fetchSearchAnalytics(storeId: string, days = 28) {
  const store = await getStore(storeId);
  const gscCfg = store?.config?.gsc;
  if (!gscCfg?.refreshTokenEnc || !gscCfg?.propertyUrl) throw new Error('GSC not connected for store');
  const refresh = decrypt(gscCfg.refreshTokenEnc, process.env.ENCRYPTION_KEY!);
  const tok = await refreshAccessToken(refresh);
  const access = tok.access_token;
  if (!access) throw new Error('No access token after refresh');

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const startDate = start.toISOString().slice(0,10);
  const endDate = end.toISOString().slice(0,10);
  const prop = encodeURIComponent(gscCfg.propertyUrl);

  const url = `${GSC_API}/sites/${prop}/searchAnalytics/query`;
  const body = {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    rowLimit: 5000,
    searchType: 'web',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('GSC query failed: ' + txt);
  }
  const data = await res.json();
  const rows = (data.rows || []).map((r: any) => ({
    date_start: startDate,
    date_end: endDate,
    query: r.keys[0],
    page: r.keys[1],
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }));
  return { rows, property: gscCfg.propertyUrl, lastSynced: new Date().toISOString() };
}
