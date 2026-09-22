import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cookies } from 'next/headers';
import { listStores, getStore, updateStore, getActiveStoreId } from '@/src/lib/db/stores';
import { inferBrandVoice } from '@/src/lib/agents/brand/voice';
import { writeKnowledge } from '@/src/lib/brain/memory';
import { createAdminClient } from '@/src/lib/shopify/client';
import { fetchStoreSamples, fetchMetafieldDefinitions, fetchMetafieldValueSamples } from '@/src/lib/shopify/content';
import { syncProductsForStore, syncCatalogForStore } from '@/src/lib/shopify/sync';
import { listProducts } from '@/src/lib/db/products';
import { getDefaultSEORules } from '@/src/lib/seo/rules';
import { SEORulesEditor } from '@/components/SEORulesEditor';

async function resyncInngest() {
  'use server';
  const apiKey = process.env.INNGEST_API_KEY;
  const appId = process.env.INNGEST_APP_ID || 'shopify-brain';
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

export const dynamic = 'force-dynamic';

export default async function Settings({ searchParams }: { searchParams?: Promise<{ resync?: string; brand?: string; autonomy?: string; knowledge?: string; url?: string; status?: string; message?: string; placement?: string; placementReason?: string; metafields?: string; products?: string; count?: string; seoRules?: string; catalog?: string; gsc?: string }> }) {
  const params = await (searchParams || Promise.resolve({})) as { resync?: string; brand?: string; autonomy?: string; knowledge?: string; url?: string; status?: string; message?: string; placement?: string; placementReason?: string; metafields?: string; products?: string; count?: string; seoRules?: string; catalog?: string; gsc?: string };
  const store = await getActiveStore();
  const config = store?.config || {};
  const bv = config.brandVoice || null;
  const auto = config.autonomy || null;

  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const resolvedHandlerUrl = base ? `${base}/api/inngest` : 'https://your-domain.example/api/inngest';

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/" className="underline mb-4 block">← Back to Dashboard</Link>
      <h1 className="text-3xl font-bold mb-8">Settings</h1>

      {params.resync === 'success' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Inngest resync successful.</div>
      )}
      {params.resync === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Inngest resync failed.
          {params.url && <> Tried: <code>{params.url}</code>.</>}
          {params.status && <> Status: {params.status}.</>}
          {params.message && <> {params.message}</>}
        </div>
      )}
      {params.brand === 'generated' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Brand voice generated and saved.</div>
      )}
      {params.brand === 'saved' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Brand voice saved.</div>
      )}
      {params.brand === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error with brand voice action.
          {params.message && <> Details: {params.message}</>}
        </div>
      )}
      {params.knowledge === 'success' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Knowledge ingested successfully.</div>
      )}
      {params.knowledge === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error ingesting knowledge.
          {params.message && <> Details: {params.message}</>}
        </div>
      )}
      {params.autonomy === 'saved' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Autonomy saved.</div>
      )}
      {params.autonomy === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">Error saving autonomy.</div>
      )}
      {params.placement && (
        <div className="mb-4 p-3 bg-blue-100 text-blue-700 rounded text-sm">
          Suggested placement config (copy to /stores edit if useful):
          <pre className="mt-2 text-xs overflow-auto bg-white p-2 rounded">{decodeURIComponent(params.placement)}</pre>
          {params.placementReason && <div className="mt-1 text-xs">Reason: current placement may benefit from metafield mappings for better agent support.</div>}
        </div>
      )}
      {params.placement === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error generating placement suggestion (check store token).
          {params.message && <> Details: {params.message}</>}
        </div>
      )}
      {params.metafields === 'refreshed' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Metafield schema and values refreshed (full store now in knowledge + config).</div>
      )}
      {params.metafields === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error refreshing metafield schema (check store token/permissions).
          {params.message && <> Details: {params.message}</>}
        </div>
      )}
      {params.products === 'synced' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Products synced successfully ({params.count || '0'} imported: titles, descriptions, handles, images, metafields).</div>
      )}
      {params.products === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error syncing products: {params.message ? decodeURIComponent(params.message) : 'check that the Admin API token has read_products scope (and regenerate the token in Shopify after adding scopes).'}
        </div>
      )}
      {params.catalog === 'synced' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Live catalog synced ({params.count || '0'} collections/pages/articles).</div>
      )}
      {params.catalog === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error syncing catalog: {params.message ? decodeURIComponent(params.message) : ''}
        </div>
      )}
      {params.gsc === 'connected' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Google Search Console connected.</div>
      )}
      {params.gsc === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">GSC error: {params.message ? decodeURIComponent(params.message) : ''}</div>
      )}
      {params.seoRules === 'saved' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">SEO Rules saved. Will be used for future jobs (writer, optimize, grade, revise).</div>
      )}
      {params.seoRules === 'reset' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">SEO Rules reset to initial defaults.</div>
      )}
      {params.seoRules === 'error' && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error saving SEO Rules. {params.message ? decodeURIComponent(params.message) : ''}
        </div>
      )}

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Inngest Sync</h2>
        <div className="text-sm mb-2">Target: <code>{resolvedHandlerUrl}</code></div>
        <form action={resyncInngest} className="inline">
          <Button type="submit" variant="outline">Resync Inngest</Button>
        </form>
        <span className="ml-2 text-xs text-muted-foreground">Force function sync (uses PUBLIC_URL base + /api/inngest)</span>
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Active Store Config Status</h2>
        {store ? (
          <div className="text-sm space-y-1">
            <div>Store: {store.name} ({store.shopify_domain})</div>
            <div>Placement: {config.placement ? 'Configured' : 'Using defaults'}</div>
            <div>Metafields: {config.metafieldSchema?.lastRefreshed ? `Refreshed ${new Date(config.metafieldSchema.lastRefreshed).toLocaleDateString()} (${config.metafieldSchema.definitions?.length || 0} fields)` : 'Not loaded (use Refresh button)'}</div>
            <div>Products: {config.productsLastSynced ? `Synced ${new Date(config.productsLastSynced).toLocaleDateString()} (${config.productsSyncedCount || 0} products)` : 'Not synced (use button below)'}</div>
            <div>Catalog: {config.catalogLastSynced ? `Synced ${new Date(config.catalogLastSynced).toLocaleDateString()} (${config.catalogSyncedCount || 0} resources)` : 'Not synced (use button below or /seo/live)'}</div>
            <div>GSC: {config.gsc?.refreshTokenEnc ? 'Connected' : 'Not connected'}{config.gsc?.lastSyncedAt ? ` (synced ${new Date(config.gsc.lastSyncedAt).toLocaleDateString()})` : ''}</div>
            <div>Brand Voice: {bv ? 'Set' : 'Not set'}{bv && bv.inferredAt ? ` (inferred ${new Date(bv.inferredAt).toLocaleDateString()})` : ''}{bv && (bv.allowedClaims || bv.forbiddenClaims) ? ' + claims' : ''}</div>
            <div>SEO Rules: {config.seoRules && Array.isArray(config.seoRules) ? `${config.seoRules.length} rules` : 'Using defaults'}</div>
            <div>Autonomy: {auto ? 'Set' : 'Defaults (all types, require approval)'}</div>
          </div>
         ) : <div>No active store.</div>}
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Placement Helper (Metafields)</h2>
        <form action={generatePlacementSuggestion} className="inline mr-4">
          <Button type="submit" variant="outline">Generate suggested placement from current defs</Button>
        </form>
        <form action={refreshMetafieldSchema} className="inline">
          <Button type="submit" variant="outline">Refresh full schema + values (Brand + store mind)</Button>
        </form>
        <span className="ml-2 text-xs text-muted-foreground">Agent uses relevant fields per job type but has full store schema/values in knowledge/config. Creates new if needed.</span>
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Products Sync (for agent context)</h2>
        <form action={syncProductsAction} className="inline">
          <Button type="submit" variant="outline">Sync Products (titles, handles, descriptions, images, metafields)</Button>
        </form>
        <span className="ml-2 text-xs text-muted-foreground">Imports all products. Run on store add and ~weekly. Enables agent to recommend/include real products in collections/pages. If failing, regenerate the Admin API token in Shopify after confirming scopes.</span>
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Live Catalog Sync (collections, pages, articles)</h2>
        <form action={syncCatalogAction} className="inline">
          <Button type="submit" variant="outline">Sync Live Catalog</Button>
        </form>
        <span className="ml-2 text-xs text-muted-foreground">Used by SEO command center for GSC mapping + findings. First blog only for articles (v1 limitation). Link to /seo/live for snapshot view.</span>
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Search Console</h2>
        {!process.env.GOOGLE_CLIENT_ID && (
          <div className="text-sm text-red-600 mb-2">GSC not configured on host (missing GOOGLE_* envs). OAuth disabled.</div>
        )}
        <div className="text-sm mb-2">
          Status: {config.gsc?.refreshTokenEnc ? 'Connected' : 'Not connected'} {config.gsc?.lastSyncedAt ? `| last sync ${new Date(config.gsc.lastSyncedAt).toLocaleString()}` : ''}
          {config.gsc?.propertyUrl ? ` | ${config.gsc.propertyUrl}` : ''}
        </div>
        <div className="flex gap-2 items-center mb-2">
          <a href={`/api/gsc/oauth/start?storeId=${store?.id || ''}`} className="inline-block border px-3 py-1 rounded text-sm">Connect / Reconnect</a>
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
             <Button type="submit" variant="outline" size="sm">Disconnect</Button>
           </form>
          <form action={async () => {
            'use server';
            const { revalidatePath } = await import('next/cache');
            const { inngest } = await import('@/src/inngest/client');
            const s = await getActiveStore();
            if (s?.id) await inngest.send({ name: 'seo/gsc.sync.requested', data: { storeId: s.id } });
            revalidatePath('/settings');
          }}>
            <Button type="submit" variant="outline" size="sm">Sync 28 days</Button>
          </form>
          <span className="text-xs text-muted-foreground">Also available in /seo/search</span>
        </div>
        <div>
          <form action={async (fd: FormData) => {
            'use server';
            const { revalidatePath } = await import('next/cache');
            const prop = (fd.get('propertyUrl') as string) || '';
            const s = await getActiveStore();
            if (s) {
              const c = { ...(s.config || {}), gsc: { ...(s.config?.gsc || {}), propertyUrl: prop } };
              await updateStore(s.id, { name: s.name, shopify_domain: s.shopify_domain, shopify_access_token: '', platform: s.platform || 'shopify', config: c });
            }
            revalidatePath('/settings');
          }} className="flex gap-2">
            <input name="propertyUrl" defaultValue={config.gsc?.propertyUrl || ''} placeholder="https://www.example.com/ or sc-domain:example.com" className="border p-1 text-sm flex-1" />
            <Button type="submit" variant="outline" size="sm">Save Property</Button>
          </form>
        </div>
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Brand Voice</h2>

        <form action={generateBrandVoiceAction} className="mb-4">
          <Button type="submit" variant="outline">Generate / Regenerate from Site + Web</Button>
        </form>
        <form action={ingestKnowledgeAction} className="mb-4">
          <Button type="submit" variant="outline">Ingest / Refresh Site Knowledge</Button>
        </form>
        <form action={saveBrandVoiceAction} className="space-y-2">
          <textarea name="brandVoiceText" defaultValue={bv?.text || ''} className="border p-2 w-full h-32 font-mono text-sm" placeholder="Brand voice description..." />
          <input name="allowedClaims" defaultValue={(bv?.allowedClaims || []).join(', ')} className="border p-1 w-full text-sm" placeholder="Allowed claims (comma sep)" />
          <input name="forbiddenClaims" defaultValue={(bv?.forbiddenClaims || []).join(', ')} className="border p-1 w-full text-sm" placeholder="Forbidden claims (comma sep, go to mustNotCover)" />
          <Button type="submit">Save Brand Voice</Button>
        </form>
        {bv && <div className="mt-2 text-xs text-muted-foreground">Last updated: {bv.inferredAt ? new Date(bv.inferredAt).toLocaleString() : 'manual'} | Samples used: {bv.samplesUsed || 'n/a'}</div>}
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">SEO Rules (Structured - per store)</h2>
        <p className="text-xs text-muted-foreground mb-2">These rules are injected into writer, optimizer, grader and reviser. Edit below. IDs are used in grader feedback. Changes affect new jobs.</p>
        <form action={resetSEORulesAction} className="mb-2">
          <Button type="submit" variant="outline">Reset to Initial Defaults</Button>
        </form>
        <form action={saveSEORulesAction} className="space-y-2">
          <SEORulesEditor initialRules={config.seoRules || getDefaultSEORules()} />
          <Button type="submit">Save SEO Rules</Button>
        </form>
      </div>

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Autonomy (Basic)</h2>
        <form action={saveAutonomyAction} className="space-y-2 text-sm">
          <div>
            <label className="block mb-1">Allowed Types (comma sep, leave empty for all)</label>
            <input name="allowedTypes" defaultValue={(auto?.allowedTypes || []).join(',')} className="border p-1 w-full" placeholder="collection,page,blog" />
          </div>
          <div>
            <label>
              <input type="checkbox" name="requireApproval" defaultChecked={auto?.requireApproval !== false} /> Require human approval
            </label>
          </div>
          <Button type="submit">Save Autonomy</Button>
        </form>
      </div>
    </div>
  );
}
