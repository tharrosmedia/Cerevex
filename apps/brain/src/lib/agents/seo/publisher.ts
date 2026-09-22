import { createAdminClient } from '../../shopify/client';
import { createAndPublishCollection, addProductsToCollection, setCollectionRules } from '../../shopify/collections';
import { createAndPublishPage } from '../../shopify/pages';
import { createAndPublishArticle } from '../../shopify/blogs';
import { getStore } from '../../db/stores';
import { setMetafields } from '../../shopify/metafields';

function getSourceValue(draft: any, source: string): any {
  if (source === 'bodyHtml') return draft.bodyHtml;
  if (source === 'metaTitle') return draft.metaTitle;
  if (source === 'metaDescription') return draft.metaDescription;
  if (source === 'schemaJsonLd') return draft.schemaJsonLd;
  if (source.startsWith('metafields.')) {
    const key = source.replace(/^metafields\./, '');
    return draft.metafields?.[key];
  }
  return draft[source];
}

function getResourceId(response: any, type: string): string | null {
  if (type === 'page') return response?.data?.pageCreate?.page?.id || response?.data?.pageUpdate?.page?.id || null;
  if (type === 'blog') return response?.data?.articleCreate?.article?.id || response?.data?.articleUpdate?.article?.id || null;
  return response?.data?.collectionCreate?.collection?.id || response?.data?.collectionUpdate?.collection?.id || null;
}

function resolveMfType(defs: any[], ns: string, key: string, valForHeuristic?: string): string {
  const d = (defs || []).find((x: any) => x.namespace === ns && x.key === key);
  if (d?.type?.name) return d.type.name;
  // length heuristic only as last resort
  if (valForHeuristic && typeof valForHeuristic === 'string' && valForHeuristic.length > 150) {
    return 'multi_line_text_field';
  }
  return 'single_line_text_field';
}

export async function publishContent({ storeId, draft, type = 'collection', platform, brandVoice, products = [], preloaded, metafieldDefinitions = [], mode = 'create', shopifyId }: { storeId: string; draft: any; type?: string; platform?: string; brandVoice?: any; products?: any[]; preloaded?: { domain?: string; accessToken?: string; config?: any }; metafieldDefinitions?: any[]; mode?: string; shopifyId?: string; [k: string]: any }) {
  console.time('[PUBLISH] total');
  let store: any;
  if (preloaded && preloaded.accessToken) {
    store = { shopify_domain: preloaded.domain, shopify_access_token: preloaded.accessToken, config: preloaded.config };
  } else {
    store = await getStore(storeId);
  }
  if (!store || !store.shopify_access_token) {
    throw new Error(`No Shopify credentials configured for store ${storeId}`);
  }
  const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
  const config = store.config || (store as any).config || {};
  const placement = config.placement?.[type] || config.placement?.default || null;
  let bodyForMain: string | undefined = draft.bodyHtml;
  let useMainBody = true;
  const mfs: Array<{namespace: string; key: string; value: string; type: string}> = [];
  if (placement) {
    const bodyRule = placement.body;
    if (bodyRule) {
      if (bodyRule.target === 'metafield' && bodyRule.metafield) {
        useMainBody = !!bodyRule.populateMain;
        if (!useMainBody) bodyForMain = undefined;
        mfs.push({
          namespace: bodyRule.metafield.namespace,
          key: bodyRule.metafield.key,
          value: draft.bodyHtml || '',
          type: bodyRule.metafield.type || resolveMfType(metafieldDefinitions, bodyRule.metafield.namespace, bodyRule.metafield.key, draft.bodyHtml),
        });
      }
    }
    if (placement.metafields) {
      for (const rule of placement.metafields) {
        const val = getSourceValue(draft, rule.source);
        if (val != null) {
          const v = typeof val === 'object' ? JSON.stringify(val) : String(val);
          mfs.push({
            namespace: rule.target.namespace,
            key: rule.target.key,
            value: v,
            type: rule.target.type || resolveMfType(metafieldDefinitions, rule.target.namespace, rule.target.key, String(val)),
          });
        }
      }
    }
  }

  // Auto-set any metafields the agent produced (supports agent-created keys + "namespace.key"; best for agent)
  // Handle both record (legacy) and array (structured) forms for metafields
  const mfSource = draft.metafields;
  if (Array.isArray(mfSource)) {
    for (const mf of mfSource) {
      if (!mf || !mf.namespace || !mf.key || mf.value == null) continue;
      const already = mfs.some((m: any) => m.namespace === mf.namespace && m.key === mf.key);
      if (!already) {
        mfs.push({ namespace: mf.namespace, key: mf.key, value: String(mf.value), type: mf.type || resolveMfType(metafieldDefinitions, mf.namespace, mf.key, String(mf.value)) });
      }
    }
  } else if (mfSource && typeof mfSource === 'object') {
    for (const [fullKey, val] of Object.entries(mfSource)) {
      if (val == null) continue;
      let ns = 'custom';
      let k = fullKey;
      if (fullKey.includes('.')) {
        const parts = fullKey.split('.');
        ns = parts[0];
        k = parts.slice(1).join('.');
      }
      const already = mfs.some((m: any) => m.namespace === ns && m.key === k);
      if (!already) {
        const v = typeof val === 'object' ? JSON.stringify(val) : String(val);
        const t = resolveMfType(metafieldDefinitions, ns, k, v);
        mfs.push({ namespace: ns, key: k, value: v, type: t });
      }
    }
  }

  const mainInput: any = {
    title: draft.title,
    handle: draft.handle,
    seoTitle: draft.metaTitle,
    seoDescription: draft.metaDescription,
  };
  if (useMainBody && bodyForMain !== undefined) {
    mainInput.bodyHtml = bodyForMain || '';
  } else {
    mainInput.bodyHtml = '';
  }
  let response;
  const useId = shopifyId || draft.shopifyId;
  const isImprove = mode === 'improve' && useId;
  if (type === 'page') {
    if (isImprove && useId) {
      const { updatePage } = (await import('../../shopify/pages')) as any;
      response = await updatePage(client, useId, mainInput);
    } else {
      // try update existing by handle
      let updated = false;
      if (mainInput.handle) {
        try {
          const findQ = `query { pages(first:1, query:"handle:${mainInput.handle}") { edges { node { id } } } }`;
          const findRes = await client.request(findQ, {});
          const existing = findRes?.data?.pages?.edges?.[0]?.node;
          if (existing?.id) {
            const { updatePage } = (await import('../../shopify/pages')) as any;
            response = await updatePage(client, existing.id, mainInput);
            updated = true;
          }
        } catch {}
      }
      if (!updated) {
        response = await createAndPublishPage(client, mainInput);
      }
    }
  } else if (type === 'blog') {
    if (isImprove && useId) {
      const { updateArticle } = (await import('../../shopify/blogs')) as any;
      response = await updateArticle(client, useId, mainInput);
    } else {
      response = await createAndPublishArticle(client, mainInput);
    }
  } else {
    if (isImprove && useId) {
      const { updateCollection } = (await import('../../shopify/collections')) as any;
      response = await updateCollection(client, useId, mainInput);
    } else {
      console.time('[PUBLISH] create-main');
      response = await createAndPublishCollection(client, mainInput);
      console.timeEnd('[PUBLISH] create-main');
    }
  }
  const ownerId = getResourceId(response, type);
  const warnings: string[] = [];

  if (ownerId && mfs.length > 0) {
    console.log('[PUBLISH] setting metafields', mfs.length);
    try {
      await setMetafields(client, ownerId, mfs);
    } catch (e: any) {
      warnings.push(`metafields: ${e?.message || e}`);
      console.warn('[PUBLISH] setMetafields failed (non-fatal)', e);
    }
  } else if (ownerId) {
    console.log('[PUBLISH] no metafields to set (mfs empty, placement or draft may not define any)');
  }

  // Handle products for collections (configurable via placement; prefer draft.selectedProducts)
  let attachInfo: any = null;
  if (type === 'collection' && ownerId) {
    const typePlacement = config.placement?.[type] || config.placement?.default || null;
    const prodCfg = typePlacement?.products || { mode: 'manual', auto: true };
    const mode = prodCfg.mode || 'manual';
    const auto = prodCfg.auto !== false;
    const fromDraft = (draft.selectedProducts || []).map((p: any) => p.shopifyId).filter(Boolean);
    const fromJob = (products || []).map((p: any) => p.shopifyId).filter(Boolean);
    let ids = fromDraft.length ? fromDraft : fromJob;
    ids = Array.from(new Set(ids)).filter(Boolean);
    const max = prodCfg.maxProducts;
    if (max && max > 0) ids = ids.slice(0, max);
    if (auto === false) {
      warnings.push('products: attach skipped (auto=false)');
      attachInfo = { ids: [], mode: 'skipped', count: 0 };
    } else if (ids.length === 0) {
      warnings.push('products: no valid ids');
      attachInfo = { ids: [], mode, count: 0 };
    } else if (mode === 'rules' && (draft.collectionRules || []).length) {
      try {
        await setCollectionRules(client, ownerId, draft.collectionRules);
        attachInfo = { ids, mode: 'rules', count: ids.length };
      } catch (e: any) {
        warnings.push(`products rules: ${e?.message || e}`);
        try {
          await addProductsToCollection(client, ownerId, ids);
          attachInfo = { ids, mode: 'manual-fallback', count: ids.length };
        } catch (e2: any) {
          warnings.push(`products: ${e2?.message || e2}`);
        }
      }
    } else {
      try {
        await addProductsToCollection(client, ownerId, ids);
        attachInfo = { ids, mode: 'manual', count: ids.length };
      } catch (e: any) {
        warnings.push(`products: ${e?.message || e}`);
      }
    }
  }

  // Always return success info for the main resource + any warnings
  console.timeEnd('[PUBLISH] total');
  return { ...response, __ownerId: ownerId, __warnings: warnings, __productAttach: attachInfo };
}

export const publishCatalogPage = publishContent;
