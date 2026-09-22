import { generateObject } from 'ai';
import { z } from 'zod';
import { xai, XAI_MODEL } from '../../ai/xai';
import { formatSEORulesForPrompt } from '../../seo/rules';

export async function writeDraft({ storeId, brief, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products = [], metafieldSamples = [], storeName = '', productTypes = [], mode = 'create', liveSnapshot = null, gscQueries = [] }: { storeId: string; brief: any; type?: string; platform?: string; brandVoice?: any; seoRules?: any; metafieldDefinitions?: any[]; placement?: any; products?: any[]; metafieldSamples?: any[]; storeName?: string; productTypes?: string[]; mode?: string; liveSnapshot?: any; gscQueries?: string[] }) {
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const bvPart = bv ? ` Follow this brand voice: ${bv}.` : '';
  const plat = platform || brief.platform || '';
  const p = plat ? `${plat} ` : '';
  const keyword = (brief && (brief.keyword || brief.primaryKeyword)) || '';

  const defsStr = (metafieldDefinitions && metafieldDefinitions.length)
    ? JSON.stringify(metafieldDefinitions.map((d: any) => ({ namespace: d.namespace, key: d.key, name: d.name, type: d.type?.name, description: d.description })))
    : 'none';

  const samplesStr = (metafieldSamples && metafieldSamples.length) ? JSON.stringify(metafieldSamples.slice(0,3)).slice(0,1200) : 'none';

  const placementStr = placement ? JSON.stringify(placement) : 'default';
  const productsStr = products.length ? JSON.stringify(products.slice(0, 8).map((p: any) => ({ title: p.title, handle: p.handle, desc: (p.descriptionHtml || '').slice(0, 100) }))) : 'none';
  const catalogStr = [storeName, ...(productTypes || [])].filter(Boolean).join(' ');
  const rulesText = formatSEORulesForPrompt(seoRules);

  const isImprove = mode === 'improve' && liveSnapshot;
  const snapStr = isImprove ? JSON.stringify({ title: liveSnapshot.title, handle: liveSnapshot.handle, bodyHtml: (liveSnapshot.bodyHtml||'').slice(0,800), metaTitle: liveSnapshot.metaTitle, metaDescription: liveSnapshot.metaDescription, metafields: liveSnapshot.metafields }).slice(0,2000) : '';
  const gscPart = (gscQueries && gscQueries.length) ? ` Top GSC queries for this URL: ${gscQueries.slice(0,5).join(', ')}.` : '';
  const basePrompt = isImprove
    ? `Improve / patch the existing live Shopify ${type} (do not invent new handle; preserve shopify id if present). Start from the live snapshot. Keep existing structure where good. Primary keyword: "${brief.keyword || keyword}". Secondary from GSC: ${gscQueries?.join(', ') || ''}.`
    : `Create high-quality SEO content for a ${p}${type} about keyword "${brief.keyword}".`;
  const prompt = `${basePrompt}${bvPart}
STRICTLY follow these SEO rules:
${rulesText}
Primary goal: best SEO for this exact keyword and job.${gscPart}
Store placement: ${placementStr}
Catalog: ${catalogStr}
Live snapshot (if improve mode, PATCH this; do not create new handle): ${snapStr || 'n/a'}
Available products (use for recommendations, include in collection, link in content; copy shopifyId exactly for selectedProductIds): ${productsStr}
Available metafield definitions (use SELECTIVELY only the ones that help this specific keyword/job for best SEO; you do NOT have to use all or any. It is fine to use a subset e.g. 4 out of 8. Supply namespace, key, type, value.):
${defsStr}
Example values from store (use as style guide, do not copy verbatim): ${samplesStr}
Use this brief: ${JSON.stringify(brief)}

For metaTitle: make it stand out on SERP for the searcher intent in the brief. Adaptive, benefit/specific/curiosity driven, natural keyword, ~50-60 chars. No lazy titles.
For metaDescription: speak directly to intent, benefit-focused, compelling, non-repetitive, ~155 chars.
Return structured content. Output metafields as ARRAY of {namespace, key, type?, value} (not record). Body and chosen metas must not duplicate content. Reference real product titles/handles where they fit naturally.
For collections, output selectedProductIds as array of exact shopifyId strings from the products list (never invent). Set collectionStrategy to 'manual' by default. Include collectionRules only if real rules provided.
If improve: keep the original handle from snapshot; attach shopifyId to result if present.`;

  const { object } = await generateObject({
    model: xai(XAI_MODEL),
    schema: z.object({
      title: z.string(),
      handle: z.string(),
      bodyHtml: z.string(),
      metaTitle: z.string(),
      metaDescription: z.string(),
      metafields: z.array(z.object({ namespace: z.string(), key: z.string(), type: z.string().optional(), value: z.string() })).optional(),
      selectedProductIds: z.array(z.string()).optional(),
      collectionStrategy: z.enum(['manual', 'rules']).optional(),
      collectionRules: z.array(z.object({ column: z.string(), relation: z.string(), condition: z.string() })).optional(),
    }),
    prompt,
  });

  const out: any = {
    ...object,
    type,
    brandVoice,
    platform,
  };
  if (isImprove && liveSnapshot) {
    out.handle = liveSnapshot.handle || object.handle;
    if (liveSnapshot.shopifyId) out.shopifyId = liveSnapshot.shopifyId;
  }
  return out;
}
