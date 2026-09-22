import { gradeDraft } from '../seo/grader';

export async function evaluate(draft: any, type = 'collection', platform?: string, brandVoice?: any, seoRules?: any, metafieldDefinitions?: any[], placement?: any, products: any[] = [], brief?: any, research?: any) {
  // Delegate to the rich grader (score 0-10). Scale to 0-1 for legacy callers.
  const g = await gradeDraft({ draft, type, platform, brandVoice, seoRules, metafieldDefinitions, placement, products, brief, research });
  const legacyScore = Math.max(0, Math.min(1, (g.score || 0) / 10));
  return {
    // keep richer fields from grader (score 0-10 etc)
    ...g,
    length: (draft.bodyHtml || '').length,
    hasFaq: !!(draft.bodyHtml || '').toLowerCase().includes('faq'),
    // legacy 0-1 score for any old callers
    score: legacyScore,
    suggestions: g.suggestions || [],
    type,
    brandVoice,
    platform,
  };
}
