import { generateObject } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { z } from 'zod';

const BriefSchema = z.object({
  primaryKeyword: z.string().optional(),
  secondaryKeywords: z.array(z.string()).optional(),
  intent: z.string(),
  mustCover: z.array(z.string()).optional(),
  mustNotCover: z.array(z.string()).optional(),
  allowedClaims: z.array(z.string()).optional(),
  sectionOutline: z.array(z.object({ heading: z.string(), bullets: z.array(z.string()).optional(), purpose: z.string().optional() })).optional(),
  toneNotes: z.string().optional(),
  researchSummary: z.string(),
  metafieldPlan: z.array(z.object({ namespace: z.string(), key: z.string(), type: z.string().optional(), reason: z.string().optional() })).optional(),
  productPlan: z.object({ mode: z.enum(['manual','rules']).optional(), maxProducts: z.number().optional(), selectedProductIds: z.array(z.string()).optional() }).optional(),
});

export async function createBrief({ storeId, keyword, research, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products = [], metafieldSamples = [], storeName = '', productTypes = [] }: { storeId: string; keyword: string; research: any; type?: string; platform?: string; brandVoice?: any; seoRules?: any; metafieldDefinitions?: any[]; placement?: any; products?: any[]; metafieldSamples?: any[]; storeName?: string; productTypes?: string[] }) {
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const forbiddenClaims = (brandVoice && brandVoice.forbiddenClaims) || [];
  const allowedClaims = (brandVoice && brandVoice.allowedClaims) || [];
  const researchSum = research?.summary || '';
  const defsStr = (metafieldDefinitions && metafieldDefinitions.length) ? JSON.stringify(metafieldDefinitions.map((d: any) => ({ namespace: d.namespace, key: d.key, name: d.name, type: d.type?.name }))) : 'none';
  const samplesStr = (metafieldSamples && metafieldSamples.length) ? JSON.stringify(metafieldSamples.slice(0,2)).slice(0,800) : 'none';
  const placementStr = placement ? JSON.stringify(placement) : 'default';
  const productsStr = products.length ? `Relevant products: ${products.slice(0,5).map((p: any) => p.title + '(/' + p.handle + ')').join(', ')}` : 'none';
  const catalogStr = [storeName, ...(productTypes || [])].filter(Boolean).join(' ');
  try {
    const { object } = await generateObject({
      model: xai(XAI_MODEL),
      schema: BriefSchema,
      prompt: `Create a detailed content brief for a ${type} on "${keyword}". Research: ${researchSum}. Brand voice: ${bv}. Platform: ${platform}. Placement: ${placementStr}. Products: ${productsStr}. Catalog: ${catalogStr}. Available metafields (use selectively; plan which to populate): ${defsStr}. Sample values: ${samplesStr}. 
Include: primaryKeyword, secondaryKeywords, intent, mustCover (key points), mustNotCover (off-topic; include any forbidden claims from brand), allowedClaims, sectionOutline (3-6 with heading + optional bullets + purpose), toneNotes, refined researchSummary, optional metafieldPlan, productPlan with selectedProductIds if fitting.
Use real products for recommendations and collections. Focus on topic for the keyword.`,
    });
    const result = {
      keyword,
      type,
      platform,
      brandVoice,
      ...object,
    };
    if (forbiddenClaims && forbiddenClaims.length) {
      result.mustNotCover = [...(result.mustNotCover || []), ...forbiddenClaims];
    }
    if (allowedClaims && allowedClaims.length) {
      result.allowedClaims = [...(result.allowedClaims || []), ...allowedClaims];
    }
    return result;
  } catch {
    let sections = ['intro', 'key specs', 'comparison', 'faqs'];
    if (type === 'page') sections = ['intro', 'details', 'benefits', 'faqs'];
    else if (type === 'blog') sections = ['intro', 'tips', 'examples', 'faqs'];
    return {
      keyword,
      type,
      platform,
      brandVoice,
      primaryKeyword: keyword,
      secondaryKeywords: [],
      intent: 'informational commercial',
      mustCover: [],
      mustNotCover: [...(forbiddenClaims || [])],
      allowedClaims: [...(allowedClaims || [])],
      sectionOutline: sections.map(s => ({heading: s, purpose: 'Cover key aspects'})),
      researchSummary: researchSum,
      metafieldPlan: [],
      productPlan: { mode: 'manual', selectedProductIds: [] },
    };
  }
}
