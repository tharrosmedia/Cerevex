import { formatSEORulesForPrompt } from '../../seo/rules';

export const WRITER_SYSTEM_PROMPT = 'Write high-quality SEO content for the keyword/job. Use available metafields selectively (job-first, not all fields required). Return structured output.';

export function buildWriterUserPrompt({ brief, type = 'collection', brandVoice, platform, seoRules }: { brief: any; type?: string; brandVoice?: any; platform?: string; seoRules?: any }) {
  const plat = platform || brief.platform || '';
  const p = plat ? `${plat} ` : '';
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const rules = formatSEORulesForPrompt(seoRules);
  return `for a ${p}${type} about keyword "${brief.keyword}".${bv ? ' Brand voice: ' + bv + '.' : ''} STRICTLY follow SEO rules:\n${rules}\nUse this brief: ${JSON.stringify(brief)}. Primary goal: best SEO for this keyword. Use metafields selectively. metaTitle must stand out for searcher intent (adaptive, ~55 chars). metaDescription must speak to intent (~155 chars, benefit focused).`;
}

export function buildWriterMessages(args: { brief: any; type?: string; brandVoice?: any; platform?: string; seoRules?: any; storeName?: string; productTypes?: string[] }) {
  const { brief, type = 'collection', brandVoice, platform, seoRules, storeName = '', productTypes = [] } = args;
  const plat = platform || brief.platform || '';
  const p = plat ? `${plat} ` : '';
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const bvPart = bv ? ` Follow this brand voice: ${bv}.` : '';
  const rules = formatSEORulesForPrompt(seoRules);
  const catalogPart = (storeName || productTypes.length) ? ` Catalog: ${storeName} ${productTypes.join(' ')}.` : '';
  return [
    { role: 'system' as const, content: `Write high-quality SEO content for a ${p}${type} about keyword "${brief.keyword}".${bvPart} STRICTLY follow these SEO rules:\n${rules}\nUse available metafield defs and placement selectively (only what helps this job/keyword for best SEO; output metafields as array [{namespace,key,type?,value}]; subset OK; no duplication). Full store schema (all types) is in knowledge for context; focus on relevant for this job. Use real products from context for recommendations and collections. Stay on-topic per brief (cover must-cover points, primary keyword centered).${catalogPart}

CRITICAL - metaTitle must stand out in SERPs for the exact searcher intent from the brief: adaptive, benefit or specificity driven, natural keyword placement, ~50-60 chars. Avoid lazy titles.
metaDescription: directly solves intent with value, ~155 chars, compelling and non-repetitive.` },
    { role: 'user' as const, content: `Use this brief: ${JSON.stringify(brief)}` }
  ];
}
