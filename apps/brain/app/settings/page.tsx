import Link from 'next/link';
import { getStore, updateStore, getActiveStoreId } from '@/src/lib/db/stores';
import { inferBrandVoice } from '@/src/lib/agents/brand/voice';
import { writeKnowledge } from '@/src/lib/brain/memory';
import { createAdminClient } from '@/src/lib/shopify/client';
import { fetchStoreSamples, fetchMetafieldDefinitions, fetchMetafieldValueSamples } from '@/src/lib/shopify/content';
import { syncProductsForStore, syncCatalogForStore } from '@/src/lib/shopify/sync';
import { getDefaultSEORules } from '@/src/lib/seo/rules';
import { SEORulesEditor } from '@/components/SEORulesEditor';
import { WorkspaceCapabilitiesSettings } from '@/components/workspace-capabilities-settings';
import { WorkspaceCallRailSettings } from '@/components/workspace-callrail-settings';
import { WorkspaceBundledCallTrackingSettings } from '@/components/workspace-bundled-call-tracking';
import { WorkspaceClaritySettings } from '@/components/workspace-clarity-settings';
import { WorkspaceSeasonalitySettings } from '@/components/workspace-seasonality-settings';
import { WorkspaceModulesSettings } from '@/components/workspace-modules-settings';
import { Flash, SettingsNav } from '@/components/settings-nav';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { GscPropertyField } from '@/components/gsc-property-field';
import { WordpressConnectSettings } from '@/components/wordpress-connect-settings';
import { SubmitButton } from '@/components/submit-button';
import { GSC_RECS_TURN_ON_CTA, GSC_SYNC_QUEUED_COPY, GSC_SYNC_RECS_OFF_COPY } from '@/src/lib/seo/gsc-copy';

async function resyncInngest() {
  'use server';
  const apiKey = process.env.INNGEST_API_KEY;
  const appId = process.env.INNGEST_APP_ID || 'Cerevex';
  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const handlerUrl = base ? `${base}/api/inngest` : '';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  revalidatePath('/settings');
  if (!apiKey) {
    redirect('/settings?resync=error&message=' + encodeURIComponent('INNGEST_API_KEY not set'));
  }
  if (!base) {
    redirect('/settings?resync=error&message=' + encodeURIComponent('PUBLIC_URL not set (base domain e.g. https://cerevex.store)'));
  }
  try {
    const res = await fetch(`https://api.inngest.com/v2/apps/${appId}/syncs`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: handlerUrl }),
    });
    const text = await res.text();
    revalidatePath('/settings');
    if (!res.ok) {
      redirect(`/settings?resync=error&url=${encodeURIComponent(handlerUrl)}&status=${res.status}&message=${encodeURIComponent((text || 'sync failed').slice(0, 200))}`);
    }
    redirect('/settings?resync=success');
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    revalidatePath('/settings');
    redirect(`/settings?resync=error&url=${encodeURIComponent(handlerUrl)}&message=${encodeURIComponent(e?.message || 'network error')}`);
  }
}

async function getActiveStore() {
  let storeId = await getActiveStoreId();
  if (!storeId) return null;
  return await getStore(storeId);
}

async function generateBrandVoiceAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?brand=error');
    return;
  }
  if (!process.env.XAI_API_KEY) {
    revalidatePath('/settings');
    redirect('/settings?brand=error&message=' + encodeURIComponent('XAI_API_KEY is required for brand voice inference'));
    return;
  }
  try {
    const bv = await inferBrandVoice({ storeId: store.id });
    const currentConfig = store.config || {};
    const newConfig = { ...currentConfig, brandVoice: bv };
    await updateStore(store.id, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: newConfig,
    });
    revalidatePath('/settings');
    redirect('/settings?brand=generated');
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    console.error('[generateBrandVoiceAction] failed:', e);
    revalidatePath('/settings');
    const msg = e?.message || 'unknown error';
    redirect('/settings?brand=error&message=' + encodeURIComponent(msg));
  }
}

async function ingestKnowledgeAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store || !store.shopify_access_token) {
    revalidatePath('/settings');
    redirect('/settings?knowledge=error');
    return;
  }
  try {
    const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
    const samples = await fetchStoreSamples(client, 5);
    for (const s of samples) {
      await writeKnowledge(store.id, `${s.title}: ${s.body}`, {
        type: 'shopify_sample',
        title: s.title,
        source: 'shopify',
      });
    }
    const bv = store.config?.brandVoice?.text;
    if (bv) {
      await writeKnowledge(store.id, bv, { type: 'brand_voice', source: 'manual' });
    }
    // Also refresh full metafield schema + values
    try {
      const mf = await fetchMetafieldValueSamples(client);
      const schemaStr = JSON.stringify(mf).slice(0, 8000);
      await writeKnowledge(store.id, `Full store metafield schema and current values: ${schemaStr}`, {
        type: 'metafield_schema_full', source: 'ingest',
      });
    } catch {}
    revalidatePath('/settings');
    redirect('/settings?knowledge=success');
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    console.error('[ingestKnowledgeAction] failed:', e);
    revalidatePath('/settings');
    const msg = e?.message || 'unknown error';
    redirect('/settings?knowledge=error&message=' + encodeURIComponent(msg));
  }
}

async function saveBrandVoiceAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const text = formData.get('brandVoiceText') as string || '';
  const allowedClaimsStr = formData.get('allowedClaims') as string || '';
  const forbiddenClaimsStr = formData.get('forbiddenClaims') as string || '';
  const store = await getActiveStore();
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?brand=error');
    return;
  }
  const currentConfig = store.config || {};
  const existing = currentConfig.brandVoice || {};
  const allowedClaims = allowedClaimsStr ? allowedClaimsStr.split(',').map(s => s.trim()).filter(Boolean) : (existing.allowedClaims || []);
  const forbiddenClaims = forbiddenClaimsStr ? forbiddenClaimsStr.split(',').map(s => s.trim()).filter(Boolean) : (existing.forbiddenClaims || []);
  const newBv = typeof existing === 'object' ? { ...existing, text, allowedClaims, forbiddenClaims } : { text, allowedClaims, forbiddenClaims };
  const newConfig = { ...currentConfig, brandVoice: newBv };
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: newConfig,
  });
  revalidatePath('/settings');
  redirect('/settings?brand=saved');
}

async function saveSEORulesAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const rulesStr = formData.get('seoRulesJson') as string || '';
  const store = await getActiveStore();
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?seoRules=error');
    return;
  }
  let parsed: any = null;
  try {
    parsed = rulesStr ? JSON.parse(rulesStr) : getDefaultSEORules();
    if (!Array.isArray(parsed)) throw new Error('seoRules must be an array');
    // Basic server validation
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object' || !item.id || !item.rule || !item.category) {
        throw new Error(`Rule ${i} missing required fields (id, category, rule)`);
      }
    }
  } catch (e: any) {
    revalidatePath('/settings');
    redirect('/settings?seoRules=error&message=' + encodeURIComponent('Invalid rules data: ' + (e?.message || '')));
    return;
  }
  const currentConfig = store.config || {};
  const newConfig = { ...currentConfig, seoRules: parsed };
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: newConfig,
  });
  revalidatePath('/settings');
  redirect('/settings?seoRules=saved');
}

async function resetSEORulesAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?seoRules=error');
    return;
  }
  const currentConfig = store.config || {};
  const newConfig = { ...currentConfig, seoRules: getDefaultSEORules() };
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: newConfig,
  });
  revalidatePath('/settings');
  redirect('/settings?seoRules=reset');
}

async function saveAutonomyAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?autonomy=error');
    return;
  }
  const allowed = (formData.get('allowedTypes') as string || '').split(',').map(s => s.trim()).filter(Boolean);
  const requireApproval = formData.get('requireApproval') === 'on';
  const currentConfig = store.config || {};
  const newConfig = {
    ...currentConfig,
    autonomy: {
      allowedTypes: allowed.length ? allowed : undefined,
      requireApproval,
    },
  };
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: newConfig,
  });
  revalidatePath('/settings');
  redirect('/settings?autonomy=saved');
}

async function generatePlacementSuggestion() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store || !store.shopify_access_token) {
    revalidatePath('/settings');
    redirect('/settings?placement=error');
    return;
  }
  try {
    const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
    const defs = await fetchMetafieldDefinitions(client);
    const existing = (store.config?.placement || {}) as any;
    // Use full defs (all types) for comprehensive suggestions
    const suggestedByType: any = {};
    ['COLLECTION', 'PRODUCT', 'PAGE', 'ARTICLE'].forEach((ot) => {
      const typeDefs = defs.filter((d: any) => d.ownerType === ot).slice(0, 8);
      if (typeDefs.length) {
        suggestedByType[ot.toLowerCase()] = {
          body: existing[ot.toLowerCase()]?.body || { target: 'main' },
          metafields: typeDefs.map((d: any) => ({
            source: `metafields.${d.namespace}.${d.key}`,
            target: { namespace: d.namespace, key: d.key, type: (d.type?.name || '').includes('rich') ? 'multi_line_text_field' : 'single_line_text_field' }
          }))
        };
      }
    });
    const hasReason = Object.keys(suggestedByType).some((k) => !existing[k]?.metafields || existing[k].metafields.length < 3);
    const newPlacement = { ...(existing || {}), ...suggestedByType };
    // Add product config option for collections
    if (!newPlacement.collection) newPlacement.collection = {};
    if (!newPlacement.collection.products) {
      newPlacement.collection.products = { mode: 'manual', auto: true };
    }
    const suggestedConfig = { placement: newPlacement };
    const json = JSON.stringify(suggestedConfig, null, 2);
    revalidatePath('/settings');
    redirect(`/settings?placement=${encodeURIComponent(json)}${hasReason ? '&placementReason=merge' : ''}`);
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    revalidatePath('/settings');
    redirect('/settings?placement=error');
  }
}

async function refreshMetafieldSchema() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store || !store.shopify_access_token) {
    revalidatePath('/settings');
    redirect('/settings?metafields=error');
    return;
  }
  try {
    const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
    const samples = await fetchMetafieldValueSamples(client);
    // Write full schema + values to knowledge (truncated to avoid large payload issues)
    const schemaStr = JSON.stringify(samples).slice(0, 8000);
    await writeKnowledge(store.id, `Full store metafield schema and current values: ${schemaStr}`, {
      type: 'metafield_schema_full',
      source: 'refresh',
    });
    // Persist to config
    const currentConfig = store.config || {};
    const newConfig = {
      ...currentConfig,
      metafieldSchema: {
        definitions: Object.values(samples).flatMap((s: any) => s.definitions),
        samples,
        lastRefreshed: new Date().toISOString(),
      },
    };
    await updateStore(store.id, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: newConfig,
    });
    revalidatePath('/settings');
    redirect('/settings?metafields=refreshed');
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    console.error('[refreshMetafieldSchema] failed:', e);
    revalidatePath('/settings');
    const msg = e?.message || 'unknown error';
    redirect('/settings?metafields=error&message=' + encodeURIComponent(msg));
  }
}

async function syncProductsAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store || !store.shopify_access_token) {
    revalidatePath('/settings');
    redirect('/settings?products=error');
    return;
  }
  try {
    const result = await syncProductsForStore(store.id);
    const currentConfig = store.config || {};
    const newConfig = {
      ...currentConfig,
      productsLastSynced: new Date().toISOString(),
      productsSyncedCount: result.synced,
    };
    await updateStore(store.id, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: newConfig,
    });
    revalidatePath('/settings');
    redirect(`/settings?products=synced&count=${result.synced}`);
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    revalidatePath('/settings');
    const msg = e?.message || 'Failed to sync products';
    redirect(`/settings?products=error&message=${encodeURIComponent(msg)}`);
  }
}

async function syncCatalogAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store || !store.shopify_access_token) {
    revalidatePath('/settings');
    redirect('/settings?catalog=error');
    return;
  }
  try {
    const result = await syncCatalogForStore(store.id);
    const currentConfig = store.config || {};
    const newConfig = {
      ...currentConfig,
      catalogLastSynced: new Date().toISOString(),
      catalogSyncedCount: result.synced,
    };
    await updateStore(store.id, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: newConfig,
    });
    revalidatePath('/settings');
    redirect(`/settings?catalog=synced&count=${result.synced}`);
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    revalidatePath('/settings');
    const msg = e?.message || 'Failed to sync catalog';
    redirect(`/settings?catalog=error&message=${encodeURIComponent(msg)}`);
  }
}

async function saveGscRecsAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const { parsePositionThreshold, withGscStoreConfig } = await import('@/src/lib/seo/gsc-threshold');
  const store = await getActiveStore();
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?gsc=error&message=' + encodeURIComponent('No active store'));
    return;
  }
  const threshold = parsePositionThreshold(formData.get('positionThreshold'));
  const applyKillSwitch = formData.get('applyKillSwitch') === 'on';
  const next = withGscStoreConfig(store.config || {}, { positionThreshold: threshold, applyKillSwitch });
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: next,
  });
  revalidatePath('/settings');
  revalidatePath('/seo/findings');
  redirect('/settings?gsc=recs');
}

async function syncGscAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const { inngest } = await import('@/src/inngest/client');
  const { gscRecommendationsAreVisible } = await import('@/src/lib/seo/gsc-flags');
  const s = await getActiveStore();
  if (!s?.id) {
    redirect('/settings?gsc=error&message=' + encodeURIComponent('No active store'));
    return;
  }
  await inngest.send({ name: 'seo/gsc.sync.requested', data: { storeId: s.id } });
  revalidatePath('/settings');
  revalidatePath('/seo/search');
  if (!gscRecommendationsAreVisible(s)) {
    redirect('/settings?gsc=recs_off');
  }
  redirect('/settings?gsc=synced');
}

async function signOutAction() {
  'use server';
  const { cookies } = await import('next/headers');
  const { redirect } = await import('next/navigation');
  const { clearAuthCookie } = await import('@/lib/auth-cookie');
  const jar = await cookies();
  clearAuthCookie(jar as never);
  redirect('/login');
}

export const dynamic = 'force-dynamic';

export default async function Settings({ searchParams }: { searchParams?: Promise<{ resync?: string; brand?: string; autonomy?: string; knowledge?: string; url?: string; status?: string; message?: string; placement?: string; placementReason?: string; metafields?: string; products?: string; count?: string; seoRules?: string; catalog?: string; gsc?: string; modules?: string; capabilities?: string; callrail?: string; bundled?: string; clarity?: string; seasonality?: string; wordpress?: string }> }) {
  const params = await (searchParams || Promise.resolve({})) as { resync?: string; brand?: string; autonomy?: string; knowledge?: string; url?: string; status?: string; message?: string; placement?: string; placementReason?: string; metafields?: string; products?: string; count?: string; seoRules?: string; catalog?: string; gsc?: string; modules?: string; capabilities?: string; callrail?: string; bundled?: string; clarity?: string; seasonality?: string; wordpress?: string };
  let store = null;
  try {
    store = await getActiveStore();
  } catch {}
  const config = store?.config || {};
  const bv = config.brandVoice || null;
  const auto = config.autonomy || null;

  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const resolvedHandlerUrl = base ? `${base}/api/inngest` : 'https://your-domain.example/api/inngest';

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Settings"
        title="Settings"
        lede="Connects, approvals, modules, store, and account — grouped so you can find the next step."
      />
      <SettingsNav />

      {params.modules === 'saved' && <Flash>Modules saved. The Ads menu now shows only modules that are on.</Flash>}
      {params.modules === 'type' && <Flash>Business type saved. Modules were reset to the defaults for that type.</Flash>}
      {params.modules === 'error' && <Flash tone="warn">Could not save modules. Try again.</Flash>}
      {params.capabilities === 'saved' && <Flash>Capability saved. Work that is not live yet stays off the Ads menu.</Flash>}
      {params.capabilities === 'error' && <Flash tone="warn">Could not save that capability. Try again.</Flash>}
      {params.callrail === 'saved' && <Flash>CallRail / CRM join saved. Nothing was written to CallRail or Housecall Pro.</Flash>}
      {params.callrail === 'error' && <Flash tone="warn">Could not update CallRail or CRM join. Check the capability flag and try again.</Flash>}
      {params.bundled === 'saved' && <Flash>Bundled call tracking saved. No number was bought and routing was not changed.</Flash>}
      {params.bundled === 'error' && <Flash tone="warn">Could not update bundled call tracking. Disconnect CallRail first if it is connected, then try again.</Flash>}
      {params.clarity === 'saved' && <Flash>Clarity saved. Aggregated session signals only — nothing was written to the website.</Flash>}
      {params.clarity === 'error' && <Flash tone="warn">Could not update Clarity. Check the capability flag and try again.</Flash>}
      {params.seasonality === 'saved' && <Flash>Calendar saved in workspace settings. Nothing was written to Meta or Google.</Flash>}
      {params.seasonality === 'error' && <Flash tone="warn">Could not save the calendar. Turn the seasonality flag on and try again.</Flash>}
      {params.resync === 'success' && <Flash>Inngest resync successful.</Flash>}
      {params.resync === 'error' && (
        <Flash tone="warn">
          Inngest resync failed.
          {params.url && <> Tried: <code>{params.url}</code>.</>}
          {params.status && <> Status: {params.status}.</>}
          {params.message && <> {params.message}</>}
        </Flash>
      )}
      {params.brand === 'generated' && <Flash>Brand voice generated and saved.</Flash>}
      {params.brand === 'saved' && <Flash>Brand voice saved.</Flash>}
      {params.brand === 'error' && (
        <Flash tone="warn">
          Could not update brand voice.
          {params.message && <> Details: {params.message}</>}
        </Flash>
      )}
      {params.knowledge === 'success' && <Flash>Site knowledge ingested.</Flash>}
      {params.knowledge === 'error' && (
        <Flash tone="warn">
          Could not ingest knowledge.
          {params.message && <> Details: {params.message}</>}
        </Flash>
      )}
      {params.autonomy === 'saved' && <Flash>Autonomy saved.</Flash>}
      {params.autonomy === 'error' && <Flash tone="warn">Could not save autonomy.</Flash>}
      {params.placement && params.placement !== 'error' && (
        <Flash>
          Suggested placement config (copy to Stores edit if useful):
          <pre style={{ marginTop: '0.5rem', overflow: 'auto' }}>{decodeURIComponent(params.placement)}</pre>
          {params.placementReason && <span> Current placement may need more metafield mappings.</span>}
        </Flash>
      )}
      {params.placement === 'error' && (
        <Flash tone="warn">
          Could not generate a placement suggestion. Check the store token.
          {params.message && <> Details: {params.message}</>}
        </Flash>
      )}
      {params.metafields === 'refreshed' && <Flash>Metafield schema refreshed.</Flash>}
      {params.metafields === 'error' && (
        <Flash tone="warn">
          Could not refresh metafields. Check the store token.
          {params.message && <> Details: {params.message}</>}
        </Flash>
      )}
      {params.products === 'synced' && <Flash>Products synced ({params.count || '0'} imported).</Flash>}
      {params.products === 'error' && (
        <Flash tone="warn">
          Could not sync products: {params.message ? decodeURIComponent(params.message) : 'check that the Admin API token has read_products.'}
        </Flash>
      )}
      {params.catalog === 'synced' && <Flash>Live catalog synced ({params.count || '0'} collections/pages/articles).</Flash>}
      {params.catalog === 'error' && (
        <Flash tone="warn">
          Could not sync catalog{params.message ? `: ${decodeURIComponent(params.message)}` : '.'}
        </Flash>
      )}
      {params.gsc === 'connected' && <Flash>Google Search Console connected. Choose a property below.</Flash>}
      {params.gsc === 'property' && <Flash>Search Console property saved.</Flash>}
      {params.gsc === 'recs' && <Flash>Search recommendation cutoff saved for this store. Nothing was written to the site.</Flash>}
      {params.gsc === 'synced' && <Flash>{GSC_SYNC_QUEUED_COPY}</Flash>}
      {params.gsc === 'recs_off' && (
        <Flash>
          <p style={{ margin: 0 }}>{GSC_SYNC_RECS_OFF_COPY}</p>
          <div className="cx-actions" style={{ marginTop: '0.75rem' }}>
            <a href="/settings#capabilities" className="btn-cta">{GSC_RECS_TURN_ON_CTA}</a>
          </div>
        </Flash>
      )}
      {params.gsc === 'error' && <Flash tone="warn">Search Console error: {params.message ? decodeURIComponent(params.message) : ''}</Flash>}
      {params.seoRules === 'saved' && <Flash>SEO rules saved. New jobs will use them.</Flash>}
      {params.seoRules === 'reset' && <Flash>SEO rules reset to defaults.</Flash>}
      {params.seoRules === 'error' && (
        <Flash tone="warn">
          Could not save SEO rules. {params.message ? decodeURIComponent(params.message) : ''}
        </Flash>
      )}

      <section id="connects" className="cx-settings-section">
        <h2>Connects</h2>
        <p className="cx-lede">Shopify sync and Search Console live here. WordPress, CallRail, Clarity, GA4, and Housecall Pro stay hidden until their flags are on.</p>

        {params.wordpress === 'connected' && <Flash>Connected.</Flash>}
        {params.wordpress === 'tested' && <Flash>Connected. Save Connect WordPress to keep this site.</Flash>}
        {params.wordpress === 'disconnected' && <Flash>Disconnected. Review history was kept.</Flash>}
        {params.wordpress === 'syncing' && <Flash>WordPress sync queued. Posts and pages will show in Review and live catalog.</Flash>}
        {params.wordpress === 'synced' && <Flash>WordPress synced ({params.count || '0'} posts and pages).</Flash>}
        {params.wordpress === 'kill' && <Flash>WordPress write block saved. Nothing was written to the site.</Flash>}
        {params.wordpress === 'error' && (
          <Flash tone="warn">{params.message ? decodeURIComponent(params.message) : "Couldn't complete that WordPress step."}</Flash>
        )}

        <WordpressConnectSettings />

        <div className="cx-panel">
          <h2>Search Console</h2>
          {!process.env.GOOGLE_CLIENT_ID && (
            <p className="cx-help">Search Console is not configured on this host yet. Connect stays available so you can retry from Settings.</p>
          )}
          <p className="cx-help">
            <StatusBadge
              label={config.gsc?.refreshTokenEnc ? 'Connected' : 'Not connected'}
              tone={config.gsc?.refreshTokenEnc ? 'trust' : 'warn'}
            />
            {config.gsc?.lastSyncedAt ? ` · last sync ${new Date(config.gsc.lastSyncedAt).toLocaleString()}` : ''}
            {config.gsc?.propertyUrl ? ` · ${config.gsc.propertyUrl}` : ''}
          </p>
          <div className="cx-actions">
            <a href={`/api/gsc/oauth/start?storeId=${store?.id || ''}`} className="btn-cta">Connect / Reconnect</a>
            <form action={async () => {
              'use server';
              const { revalidatePath } = await import('next/cache');
              const { redirect } = await import('next/navigation');
              const s = await getActiveStore();
              if (s) {
                const c = { ...(s.config || {}) };
                if (c.gsc) delete c.gsc;
                await updateStore(s.id, { name: s.name, shopify_domain: s.shopify_domain, shopify_access_token: '', platform: s.platform || 'shopify', config: c });
              }
              revalidatePath('/settings');
              redirect('/settings?gsc=disconnected');
            }}>
              <button type="submit" className="btn-secondary">Disconnect</button>
            </form>
            <form action={syncGscAction}>
              <SubmitButton className="btn-secondary" disabled={!config.gsc?.refreshTokenEnc} pendingLabel="Syncing…">
                Sync 28 days
              </SubmitButton>
            </form>
          </div>
          <GscPropertyField
            connected={!!config.gsc?.refreshTokenEnc}
            propertyUrl={config.gsc?.propertyUrl}
            storeId={store?.id}
          />
        </div>

        <div id="gsc-recs" className="cx-panel">
          <h2>Search recommendations</h2>
          <p className="cx-help">Saved per store. “Update this page” uses this cutoff. Generation stays off until the Search recommendations flag is on.</p>
          <form action={saveGscRecsAction} className="cx-form">
            <div className="cx-field">
              <label htmlFor="positionThreshold">Place cutoff</label>
              <input
                id="positionThreshold"
                name="positionThreshold"
                type="number"
                min={1}
                max={20}
                step={0.1}
                defaultValue={config.gsc?.positionThreshold ?? 3}
              />
              <p className="cx-help">Soft start is worse than 3. You can raise or lower it.</p>
            </div>
            <p className="cx-help">
              Google often tests your page in different spots between about position 5 and position 1 while it decides whether you deserve a higher place. Sites usually only settle above about position 5 when the page is more useful to the person searching than what is already ranking there. Raising rank without making the page more useful (and more likely to convert) does not stick.
            </p>
            <label className="cx-field">
              <span>
                <input
                  type="checkbox"
                  name="applyKillSwitch"
                  defaultChecked={config.gsc?.applyKillSwitch !== false}
                />{' '}
                Block writes to the site
              </span>
              <p className="cx-help">When this block is on, Approve never writes Shopify or WordPress from a Search recommendation. Deny and Snooze never write.</p>
            </label>
            <button type="submit" className="btn-cta">Save Search recommendation settings</button>
          </form>
        </div>

        <div className="cx-panel">
          <h2>Shopify catalog</h2>
          <p className="cx-help">Sync products and live collections, pages, and articles used by SEO.</p>
          <div className="cx-actions">
            <form action={syncProductsAction}>
              <button type="submit" className="btn-secondary">Sync products</button>
            </form>
            <form action={syncCatalogAction}>
              <button type="submit" className="btn-secondary">Sync live catalog</button>
            </form>
            <Link href="/seo/live" className="btn-secondary">Open live catalog</Link>
          </div>
        </div>

        <div className="cx-panel">
          <h2>Ads accounts</h2>
          <p className="cx-help">Connect Meta or Google from Ads. This page does not start a new ads login.</p>
          <div className="cx-actions">
            <Link href="/ads" className="btn-secondary">Open Ads</Link>
          </div>
        </div>

        <WorkspaceCallRailSettings />
        <WorkspaceBundledCallTrackingSettings />
        <WorkspaceClaritySettings />
      </section>

      <section id="approvals" className="cx-settings-section">
        <h2>Approvals &amp; autonomy</h2>
        <p className="cx-lede">SEO approve gate and a pointer to Ads pause. Nothing here writes ad platforms.</p>

        <div className="cx-panel">
          <h2>SEO approval</h2>
          <form action={saveAutonomyAction} className="cx-form">
            <div className="cx-field">
              <label htmlFor="allowedTypes">Allowed types</label>
              <input id="allowedTypes" name="allowedTypes" defaultValue={(auto?.allowedTypes || []).join(',')} placeholder="collection,page,blog" />
              <p className="cx-help">Comma-separated. Leave empty to allow all types.</p>
            </div>
            <label className="cx-field">
              <span>
                <input type="checkbox" name="requireApproval" defaultChecked={auto?.requireApproval !== false} /> Require human approval
              </span>
              <p className="cx-help">When on, new SEO jobs wait in Review before they publish.</p>
            </label>
            <button type="submit" className="btn-cta">Save autonomy</button>
          </form>
        </div>

        <div className="cx-panel">
          <h2>Ads pause</h2>
          <p className="cx-help">Pause ads and approve suggestions on Ads. This settings page does not apply ads.</p>
          <Link href="/ads" className="btn-secondary">Open Ads</Link>
        </div>
      </section>

      <section id="modules" className="cx-settings-section">
        <h2>Modules &amp; flags</h2>
        <p className="cx-lede">Turn Ads modules and workspace flags on or off. SEO rules apply to new jobs only.</p>
        <WorkspaceModulesSettings />
        <WorkspaceCapabilitiesSettings />
        <WorkspaceSeasonalitySettings />

        <div className="cx-panel">
          <h2>SEO rules</h2>
          <p className="cx-help">These rules go into writer, optimizer, grader, and reviser. Changes apply to new jobs.</p>
          <form action={resetSEORulesAction} style={{ marginBottom: '0.75rem' }}>
            <button type="submit" className="btn-secondary">Reset to defaults</button>
          </form>
          <form action={saveSEORulesAction} className="cx-form">
            <SEORulesEditor initialRules={config.seoRules || getDefaultSEORules()} />
            <button type="submit" className="btn-cta">Save SEO rules</button>
          </form>
        </div>
      </section>

      <section id="store" className="cx-settings-section">
        <h2>Store</h2>
        <p className="cx-lede">Active store identity, brand voice, and sync helpers. Switch stores from the top right.</p>

        <div className="cx-panel">
          <h2>Active store</h2>
          {store ? (
            <ul className="cx-status-list">
              <li><span>Store</span><span>{store.name} ({store.shopify_domain})</span></li>
              <li><span>Placement</span><span>{config.placement ? 'Configured' : 'Using defaults'}</span></li>
              <li><span>Metafields</span><span>{config.metafieldSchema?.lastRefreshed ? `Refreshed ${new Date(config.metafieldSchema.lastRefreshed).toLocaleDateString()} (${config.metafieldSchema.definitions?.length || 0} fields)` : 'Not loaded'}</span></li>
              <li><span>Products</span><span>{config.productsLastSynced ? `Synced ${new Date(config.productsLastSynced).toLocaleDateString()} (${config.productsSyncedCount || 0})` : 'Not synced'}</span></li>
              <li><span>Catalog</span><span>{config.catalogLastSynced ? `Synced ${new Date(config.catalogLastSynced).toLocaleDateString()} (${config.catalogSyncedCount || 0})` : 'Not synced'}</span></li>
              <li>
                <span>Search Console</span>
                <span>
                  <StatusBadge
                    label={config.gsc?.refreshTokenEnc ? 'Connected' : 'Not connected'}
                    tone={config.gsc?.refreshTokenEnc ? 'trust' : 'warn'}
                  />
                </span>
              </li>
              <li><span>Brand voice</span><span>{bv ? 'Set' : 'Not set'}{bv?.inferredAt ? ` · ${new Date(bv.inferredAt).toLocaleDateString()}` : ''}</span></li>
              <li><span>SEO rules</span><span>{config.seoRules && Array.isArray(config.seoRules) ? `${config.seoRules.length} rules` : 'Using defaults'}</span></li>
              <li><span>Autonomy</span><span>{auto ? 'Set' : 'Defaults (all types, require approval)'}</span></li>
            </ul>
          ) : (
            <p className="cx-help">No active store. Add one in Stores.</p>
          )}
          <div className="cx-actions">
            <Link href="/stores" className="btn-secondary">Manage stores</Link>
          </div>
        </div>

        <div className="cx-panel">
          <h2>Brand voice</h2>
          <div className="cx-actions">
            <form action={generateBrandVoiceAction}>
              <button type="submit" className="btn-secondary">Generate from site</button>
            </form>
            <form action={ingestKnowledgeAction}>
              <button type="submit" className="btn-secondary">Ingest site knowledge</button>
            </form>
          </div>
          <form action={saveBrandVoiceAction} className="cx-form" style={{ marginTop: '1rem' }}>
            <div className="cx-field">
              <label htmlFor="brandVoiceText">Voice</label>
              <textarea id="brandVoiceText" name="brandVoiceText" defaultValue={bv?.text || ''} placeholder="Brand voice description..." />
            </div>
            <div className="cx-field">
              <label htmlFor="allowedClaims">Allowed claims</label>
              <input id="allowedClaims" name="allowedClaims" defaultValue={(bv?.allowedClaims || []).join(', ')} placeholder="Allowed claims (comma sep)" />
            </div>
            <div className="cx-field">
              <label htmlFor="forbiddenClaims">Forbidden claims</label>
              <input id="forbiddenClaims" name="forbiddenClaims" defaultValue={(bv?.forbiddenClaims || []).join(', ')} placeholder="Forbidden claims (comma sep)" />
            </div>
            <button type="submit" className="btn-cta">Save brand voice</button>
          </form>
          {bv ? <p className="cx-help">Last updated: {bv.inferredAt ? new Date(bv.inferredAt).toLocaleString() : 'manual'}</p> : null}
        </div>

        <div className="cx-panel">
          <h2>Placement helper</h2>
          <p className="cx-help">Suggest metafield mappings from the current store schema. Does not publish.</p>
          <div className="cx-actions">
            <form action={generatePlacementSuggestion}>
              <button type="submit" className="btn-secondary">Suggest placement</button>
            </form>
            <form action={refreshMetafieldSchema}>
              <button type="submit" className="btn-secondary">Refresh metafields</button>
            </form>
          </div>
        </div>

        <div className="cx-panel">
          <h2>Job runner</h2>
          <p className="cx-help">Target: <code>{resolvedHandlerUrl}</code></p>
          <form action={resyncInngest}>
            <button type="submit" className="btn-secondary">Resync Inngest</button>
          </form>
        </div>
      </section>

      <section id="account" className="cx-settings-section">
        <h2>Account</h2>
        <p className="cx-lede">Workspace sign-in and operator context. Password changes happen on the host.</p>
        <div className="cx-panel">
          <h2>Sign in</h2>
          <p className="cx-help">
            This workspace uses a shared sign-in password. There is no in-app password form — change <code>APP_PASSWORD</code> on the host if you need a new one.
          </p>
          <p className="cx-help">Switch stores from the store switcher in the top right.</p>
          <form action={signOutAction}>
            <button type="submit" className="btn-secondary">Sign out</button>
          </form>
        </div>
      </section>
    </div>
  );
}
