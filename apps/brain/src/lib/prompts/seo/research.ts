export const RESEARCH_SYSTEM_PROMPT = 'Summarize key facts, competitors, questions and angles for content. Use metafield schema selectively if helpful for the keyword.';

export function buildResearchUserPrompt({ keyword, type = 'collection', searchData, brandVoice, platform }: { keyword: string; type?: string; searchData: any; brandVoice?: any; platform?: string }) {
  const dataStr = JSON.stringify(searchData).slice(0, 2000);
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  return `Use this search data: ${dataStr}${bv ? ' Brand voice: ' + bv : ''}`;
}

export function buildResearchMessages(args: { keyword: string; type?: string; searchData: any; brandVoice?: any; platform?: string; storeName?: string; productTypes?: string[] }) {
  const { keyword, type = 'collection', searchData, brandVoice, platform, storeName = '', productTypes = [] } = args;
  const dataStr = JSON.stringify(searchData).slice(0, 2000);
  const plat = platform ? `${platform} ` : '';
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const bvPart = bv ? ` Follow this brand voice: ${bv}.` : '';
  const knowledgePart = searchData?.knowledge?.length ? ` Use relevant store knowledge: ${searchData.knowledge.join(' | ')}.` : '';
  const productsPart = searchData?.products?.length ? ` Available products for recommendations/links/collections: ${searchData.products.map((p: any) => `${p.title} (handle: ${p.handle})`).join('; ')}.` : '';
  const catalogPart = (storeName || productTypes.length) ? ` Store/catalog context: ${storeName} ${productTypes.join(' ')}.` : '';
  return [
    { role: 'system' as const, content: `Summarize key facts, competitors, questions and angles for a ${plat}${type} about: ${keyword}.${bvPart}${knowledgePart}${productsPart}${catalogPart} Consider available metafield schema (full store in knowledge, relevant for type) selectively if it helps angles for this keyword (job-first bias). Use real product titles/handles when relevant. Keep summary on-topic for the primary keyword.` },
    { role: 'user' as const, content: `Use this search data: ${dataStr}` }
  ];
}
