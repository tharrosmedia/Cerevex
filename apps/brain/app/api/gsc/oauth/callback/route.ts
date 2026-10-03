import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { publicRedirect } from '@/lib/public-url';
import { exchangeCode, isGscConfigured } from '@/src/lib/gsc/client';
import { GscOAuthStateError, oauthSubjectFromCookie, verifyGscOAuthState } from '@/src/lib/gsc/oauth-state';
import { getStore, updateStore } from '@/src/lib/db/stores';
import { encrypt } from '@/src/lib/encryption';
import { logEvent } from '@/src/lib/brain/events';

export async function GET(req: NextRequest) {
  if (!isGscConfigured()) {
    return new Response('GSC not configured on host', { status: 400 });
  }
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) return new Response('missing code/state', { status: 400 });
  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value ?? '';
  const storeHint = req.nextUrl.searchParams.get('storeId') || undefined;
  let storeId = '';
  try {
    const verified = verifyGscOAuthState(state, {
      sub: oauthSubjectFromCookie(cookie),
      storeId: storeHint,
    });
    storeId = verified.storeId;
    const tokens = await exchangeCode(code);
    const refresh = tokens.refresh_token;
    if (!refresh) throw new Error('No refresh_token (ensure access_type=offline and re-consent)');
    const store = await getStore(storeId);
    if (!store) throw new Error('store not found');
    const enc = encrypt(refresh, process.env.ENCRYPTION_KEY);
    const current = store.config || {};
    const gsc = { ...(current.gsc || {}), refreshTokenEnc: enc, connectedAt: new Date().toISOString() };
    await updateStore(storeId, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: { ...current, gsc },
    });
    await logEvent(storeId, 'system', 'gsc.connected', { property: current.gsc?.propertyUrl || 'pending' });
    return Response.redirect(publicRedirect('/settings?gsc=connected', req));
  } catch (e: any) {
    const codeName = e instanceof GscOAuthStateError ? e.code : '';
    console.error('gsc callback', codeName || e);
    const message = codeName || e?.message || 'oauth failed';
    return Response.redirect(publicRedirect(`/settings?gsc=error&message=${encodeURIComponent(message)}`, req));
  }
}
