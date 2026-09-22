import { generateObject } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { z } from 'zod';
import { formatSEORulesForPrompt } from '../../seo/rules';

const ReviseSchema = z.object({
  title: z.string(),
  handle: z.string(),
  bodyHtml: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  metafields: z.array(z.object({ namespace: z.string(), key: z.string(), type: z.string().optional(), value: z.string() })).optional(),
  schemaJsonLd: z.record(z.string(), z.any()).optional(),
  selectedProductIds: z.array(z.string()).optional(),
  collectionStrategy: z.enum(['manual', 'rules']).optional(),
  collectionRules: z.array(z.object({ column: z.string(), relation: z.string(), condition: z.string() })).optional(),
});

export async function reviseDraft({
  draft,
  feedback,
  type = 'collection',
  platform,
  brandVoice,
  seoRules,
  metafieldDefinitions = [],
  placement,
  products = [],
  brief,
  research,
  metafieldSamples = [],
  storeName = '',
  productTypes = [],
  mode = 'create',
  liveSnapshot = null,
  gscQueries = [],
}: {
  draft: any;
  feedback: any;
  type?: string;
  platform?: string;
  brandVoice?: any;
  seoRules?: any;
  metafieldDefinitions?: any[];
  placement?: any;
  products?: any[];
  brief?: any;
  research?: any;
  metafieldSamples?: any[];
  storeName?: string;
  productTypes?: string[];
  mode?: string;
  liveSnapshot?: any;
  gscQueries?: string[];
}) {
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const intent = brief?.intent || (research?.summary ? research.summary.slice(0, 600) : '');
  const researchSum = research?.summary || brief?.researchSummary || '';
  const currentMfs = Array.isArray(draft.metafields) ? draft.metafields : (draft.metafields ? Object.entries(draft.metafields).map(([k,v])=>({namespace:'custom',key:k,value:String(v)})) : []);
  const current = JSON.stringify({
    title: draft.title,
    handle: draft.handle,
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
    bodyHtml: (draft.bodyHtml || '').slice(0, 1400),
    metafields: currentMfs,
  }, null, 2);

  const defsStr = (metafieldDefinitions && metafieldDefinitions.length)
    ? JSON.stringify(metafieldDefinitions.map((d: any) => ({ namespace: d.namespace, key: d.key, name: d.name, type: d.type?.name, description: d.description })))
    : 'none';

  const samplesStr = (metafieldSamples && metafieldSamples.length) ? JSON.stringify(metafieldSamples.slice(0,3)).slice(0,1200) : 'none';

  const productsStr = products.length ? JSON.stringify(products.slice(0, 8).map((p: any) => ({ title: p.title, handle: p.handle, desc: (p.descriptionHtml || '').slice(0, 80) }))) : 'none';
  const catalogStr = [storeName, ...(productTypes || [])].filter(Boolean).join(' ');

  const fb = typeof feedback === 'string' ? feedback : JSON.stringify(feedback || {});
  const rulesText = formatSEORulesForPrompt(seoRules);
  const isImprove = mode === 'improve' && liveSnapshot;
  const snap = isImprove ? JSON.stringify({ title: liveSnapshot.title, handle: liveSnapshot.handle, body: (liveSnapshot.bodyHtml||'').slice(0,600), meta: liveSnapshot.metaTitle }).slice(0,1200) : '';
  const gscP = gscQueries?.length ? ` GSC queries: ${gscQueries.slice(0,4).join(', ')}` : '';
  const prompt = `You are an expert SEO reviser. ${isImprove ? 'Improve mode: PATCH the live snapshot (keep handle and shopifyId; do not invent new handle).' : 'The current draft scored below target on the grader.'} Use the grader feedback (including any rule violations) to produce a significantly better version. STRICTLY adhere to the SEO rules.

SEO RULES:
${rulesText}

Searcher intent: ${intent}
Research angles: ${researchSum}
Brand voice: ${bv}
Type: ${type}
Placement: ${placement ? JSON.stringify(placement) : 'default'}
Catalog: ${catalogStr}${gscP}
${isImprove ? 'Live snapshot to patch: ' + snap : ''}

Grader feedback (use this to drive changes; address violations by ruleId):
${fb}

Current draft:
${current}

Available metafield definitions (use relevant ones selectively for structure e.g. FAQs when they exist for this type; output as array of {namespace,key,type,value}):
${defsStr}
Example values from store: ${samplesStr}

  Available products (reference real ones naturally for recommendations, collection inclusion, credibility; for selectedProductIds copy exact shopifyId from list):
${productsStr}

Rules:
- You MAY change title, handle, metaTitle, metaDescription, bodyHtml, metafields, schema, selectedProductIds, collectionStrategy, collectionRules as needed.
- Address all rule violations from grader feedback.
- Do not duplicate content between body and metas.
- IDs for selectedProductIds must come only from provided products list.
${isImprove ? '- Keep handle from liveSnapshot. Attach shopifyId if present.' : ''}

Return the complete improved structured draft.`;

  try {
    const { object } = await generateObject({
      model: xai(XAI_MODEL),
      schema: ReviseSchema,
      prompt,
    });
    const out = {
      ...draft,
      ...object,
      type,
      brandVoice,
      platform,
    };
    if (isImprove && liveSnapshot && liveSnapshot.handle) out.handle = liveSnapshot.handle;
    if (isImprove && liveSnapshot && liveSnapshot.shopifyId) out.shopifyId = liveSnapshot.shopifyId;
    return out;
  } catch {
    // fallback: light pass-through with small improvement note
    const out: any = {
      ...draft,
      metaTitle: draft.metaTitle || (draft.title + ' | Options'),
      metaDescription: (draft.metaDescription || (draft.bodyHtml || '').slice(0, 155)),
      type,
      brandVoice,
      platform,
    };
    if (isImprove && liveSnapshot && liveSnapshot.handle) out.handle = liveSnapshot.handle;
    if (isImprove && liveSnapshot && liveSnapshot.shopifyId) out.shopifyId = liveSnapshot.shopifyId;
    return out;
  }
}
