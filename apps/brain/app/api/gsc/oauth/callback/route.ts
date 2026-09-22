import { NextRequest } from 'next/server';
import { exchangeCode, isGscConfigured } from '@/src/lib/gsc/client';
import { getStore, updateStore } from '@/src/lib/db/stores';
import { encrypt } from '@/src/lib/encryption';
import { logEvent } from '@/src/lib/brain/events';

export async function GET(req: NextRequest) {
  if (!isGscConfigured()) {
    return new Response('GSC not configured on host', { status: 400 });
  }
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state'); // storeId
  if (!code || !state) return new Response('missing code/state', { status: 400 });
  try {
    const tokens = await exchangeCode(code);
    const refresh = tokens.refresh_token;
    if (!refresh) throw new Error('No refresh_token (ensure access_type=offline and re-consent)');
    const store = await getStore(state);
    if (!store) throw new Error('store not found');
    const enc = encrypt(refresh, process.env.ENCRYPTION_KEY!);
    const current = store.config || {};
    const gsc = { ...(current.gsc || {}), refreshTokenEnc: enc, connectedAt: new Date().toISOString() };
    await updateStore(state, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: { ...current, gsc },
    });
    await logEvent(state, 'system', 'gsc.connected', { property: current.gsc?.propertyUrl || 'pending' });
    return Response.redirect(new URL(`/settings?gsc=connected`, req.url));
  } catch (e: any) {
    console.error('gsc callback', e);
    return Response.redirect(new URL(`/settings?gsc=error&message=${encodeURIComponent(e?.message || 'oauth failed')}`, req.url));
  }
}
