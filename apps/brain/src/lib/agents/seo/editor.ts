import { generateText } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { formatSEORulesForPrompt } from '../../seo/rules';

export async function editDraft({ storeId, draft, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products = [], metafieldSamples = [], storeName = '', productTypes = [], mode = 'create', liveSnapshot = null, gscQueries = [] }: { storeId: string; draft: any; type?: string; platform?: string; brandVoice?: any; seoRules?: any; metafieldDefinitions?: any[]; placement?: any; products?: any[]; metafieldSamples?: any[]; storeName?: string; productTypes?: string[]; mode?: string; liveSnapshot?: any; gscQueries?: string[] }) {
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const content = (draft.bodyHtml || '').slice(0, 1500);
  const rulesText = formatSEORulesForPrompt(seoRules);
  try {
    const { text } = await generateText({
      model: xai(XAI_MODEL),
      system: `You are an expert editor. STRICTLY follow these SEO rules:\n${rulesText}\nImprove the provided ${type} content for clarity, SEO, flow and adherence to brand voice: ${bv}. Keep similar length and structure. Return only the improved body HTML. If metafields present, selectively improve only relevant ones for the keyword (job-first, no need to touch all). Incorporate real product references if relevant.`,
      prompt: `Edit this draft for keyword context: ${draft.title || ''}. Content: ${content}. Current metafields: ${JSON.stringify(Array.isArray(draft.metafields)?draft.metafields:(draft.metafields||{}))}. Products: ${products.slice(0,3).map((p:any)=>p.title).join(', ')}`,
    });
    const cleaned = (text || draft.bodyHtml || '').trim().replace(/^```html\s*/i, '').replace(/\s*```$/i, '').trim();
    // optionally refine metas lightly here if wanted, but keep simple pass-through for now
    return { ...draft, bodyHtml: cleaned, type, brandVoice, platform };
  } catch {
    return { ...draft, type, brandVoice, platform };
  }
}
