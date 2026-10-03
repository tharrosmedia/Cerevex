import { NextRequest, NextResponse } from 'next/server';
import { publicRedirect } from '@/lib/public-url';
import { isProductionRuntime } from '@/lib/runtime-env';
import { exchangeCode, isGscConfigured } from '@/src/lib/gsc/client';
import {
  GSC_OAUTH_SID_COOKIE,
  GscOAuthStateError,
  gscOAuthBind,
  verifyGscOAuthState,
} from '@/src/lib/gsc/oauth-state';
import { getStore, updateStore } from '@/src/lib/db/stores';
import { encrypt } from '@/src/lib/encryption';
import { logEvent } from '@/src/lib/brain/events';

function finish(location: string | URL) {
  const response = NextResponse.redirect(location);
  response.cookies.set({
    name: GSC_OAUTH_SID_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProductionRuntime(),
    path: '/api/gsc/oauth',
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest) {
  if (!isGscConfigured()) {
    return new Response('GSC not configured on host', { status: 400 });
  }
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) return new Response('missing code/state', { status: 400 });
  const storeHint = req.nextUrl.searchParams.get('storeId') || undefined;
  let storeId = '';
  try {
    const sid = req.cookies.get(GSC_OAUTH_SID_COOKIE)?.value ?? '';
    if (!sid) throw new GscOAuthStateError('bind_mismatch');
    const verified = verifyGscOAuthState(state, {
      bind: gscOAuthBind(sid),
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
    return finish(publicRedirect('/settings?gsc=connected', req));
  } catch (e: any) {
    const codeName = e instanceof GscOAuthStateError ? e.code : '';
    console.error('gsc callback', codeName || 'oauth failed');
    const message = codeName || 'oauth failed';
    return finish(publicRedirect(`/settings?gsc=error&message=${encodeURIComponent(message)}`, req));
  }
}
