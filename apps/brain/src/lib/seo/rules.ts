export const RULE_CATEGORIES = ['title', 'metaDescription', 'content', 'metafields', 'products', 'overall'] as const;
export type RuleCategory = typeof RULE_CATEGORIES[number];

export interface SEORule {
  id: string;
  category: RuleCategory;
  rule: string;
}

export const DEFAULT_SEO_RULES: readonly SEORule[] = [
  { id: 'title-intent', category: 'title', rule: 'Meta title must speak directly and completely to the searcher intent from brief/research. Adaptive to competition.' },
  { id: 'title-standout', category: 'title', rule: 'Make meta title attention-grabbing using benefit, specificity, curiosity, numbers, comparison or power words as appropriate. ~50-60 chars ideal.' },
  { id: 'title-natural', category: 'title', rule: 'Natural primary keyword placement. Avoid lazy patterns like just the keyword or "Keyword | Options".' },
  { id: 'meta-intent', category: 'metaDescription', rule: 'Meta description must directly address searcher intent with unique value, key benefit or proof. Benefit-focused and compelling.' },
  { id: 'meta-length', category: 'metaDescription', rule: 'Meta description ~150-160 characters. No repetition of body text, no keyword stuffing.' },
  { id: 'content-structure', category: 'content', rule: 'Clean HTML structure with headings (h2/h3), lists (ul/ol), short paragraphs. No walls of repetitive text. Flows logically.' },
  { id: 'content-products', category: 'content', rule: 'Reference real products from context naturally for recommendations, credibility or inclusion (especially collections).' },
  { id: 'metafields-use', category: 'metafields', rule: 'When relevant COLLECTION/PAGE metafield defs exist (e.g. FAQ), populate with distinct useful values. Prefer structured fields over dumping everything in body.' },
  { id: 'no-dupe', category: 'overall', rule: 'Do not duplicate content between bodyHtml and metaTitle/metaDescription.' },
  { id: 'brand-voice', category: 'overall', rule: 'Match the provided brand voice in tone, vocabulary and style.' },
  { id: 'useful-seo', category: 'overall', rule: 'Overall: helpful for the user, strong SEO for the exact keyword, best possible draft for the job.' },
  { id: 'content-topic', category: 'content', rule: 'Stay tightly on-topic per brief: cover mustCover points, avoid mustNotCover, center primaryKeyword in title/meta/body without drift.' },
] as const;

export function getDefaultSEORules(): SEORule[] {
  return [...DEFAULT_SEO_RULES];
}

export function formatSEORulesForPrompt(rules?: SEORule[] | null): string {
  const list = rules && rules.length > 0 ? rules : getDefaultSEORules();
  return list.map((r, i) => `${i + 1}. [${r.id}] ${r.rule}`).join('\n');
}
