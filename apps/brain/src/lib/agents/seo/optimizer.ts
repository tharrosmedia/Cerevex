import { generateObject } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { z } from 'zod';
import { formatSEORulesForPrompt } from '../../seo/rules';

const OptimizeSchema = z.object({
  metaTitle: z.string(),
  metaDescription: z.string().optional(),
  schemaJsonLd: z.record(z.string(), z.any()),
});

export async function optimizeDraft({ storeId, draft, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products = [], metafieldSamples = [], storeName = '', productTypes = [], mode = 'create', liveSnapshot = null, gscQueries = [] }: { storeId: string; draft: any; type?: string; platform?: string; brandVoice?: any; seoRules?: any; metafieldDefinitions?: any[]; placement?: any; products?: any[]; metafieldSamples?: any[]; storeName?: string; productTypes?: string[]; mode?: string; liveSnapshot?: any; gscQueries?: string[] }) {
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const base = draft.title || draft.keyword || '';
  const defsStr = (metafieldDefinitions && metafieldDefinitions.length) ? 'defs available' : 'no defs';
  const rulesText = formatSEORulesForPrompt(seoRules);
  try {
    const { object } = await generateObject({
      model: xai(XAI_MODEL),
      schema: OptimizeSchema,
      prompt: `Optimize metaTitle, metaDescription and schema for a ${type} about "${base}".
STRICTLY follow these SEO rules:
${rulesText}

Searcher intent and angles from brief/research must drive the copy.
Brand voice: ${bv}. Platform: ${platform}.
Current title: ${base}.
Products available: ${products.slice(0,3).map((p:any)=>p.title).join(', ')}. Defs: ${defsStr}.

Selectively refine any metafields. Provide improved metaTitle, metaDescription, and schemaJsonLd object with @type appropriate for ${type}.`,
    });
    return { ...draft, ...object, brandVoice, type, platform };
  } catch {
    let schemaType = 'CollectionPage';
    if (type === 'page') schemaType = 'WebPage';
    else if (type === 'blog') schemaType = 'BlogPosting';
    return { ...draft, metaTitle: base + ' | Options', metaDescription: (draft.bodyHtml || '').slice(0, 150), schemaJsonLd: { '@type': schemaType }, brandVoice, type, platform };
  }
}
