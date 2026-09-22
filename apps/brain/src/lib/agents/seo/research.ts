import { generateText } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { buildResearchMessages } from '../../prompts/seo/research';
import { retrieve, writeKnowledge } from '../../brain/memory';

export async function research({ storeId, keyword, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products = [], metafieldSamples = [], storeName = '', productTypes = [] }: { storeId: string; keyword: string; type?: string; platform?: string; brandVoice?: any; seoRules?: any; metafieldDefinitions?: any[]; placement?: any; products?: any[]; metafieldSamples?: any[]; storeName?: string; productTypes?: string[] }) {
  const tavilyRes = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: `${keyword} ${storeName} ${productTypes.join(' ')} ${type} guide best practices`,
      max_results: 5,
      search_depth: 'basic',
    }),
  });
  const data = await tavilyRes.json();
  const keywordKnowledge = await retrieve(storeId, keyword, 3);
  const schemaKnowledge = await retrieve(storeId, 'metafield schema definitions', 2);
  const productKnowledge = products && products.length ? [`Relevant products: ${products.map((p: any) => `${p.title} (/${p.handle})`).join(', ')}`] : [];
  const knowledge = [...keywordKnowledge, ...schemaKnowledge, ...productKnowledge];
  const searchDataWithKnowledge = { ...data, knowledge, products, storeName, productTypes };
  const allMsgs = buildResearchMessages({ keyword, type, searchData: searchDataWithKnowledge, brandVoice, platform, storeName, productTypes });
  const sys = allMsgs.find(m => m.role === 'system')?.content;
  const userMsgs = allMsgs.filter(m => m.role !== 'system');
  const { text } = await generateText({
    model: xai(XAI_MODEL),
    system: sys,
    messages: userMsgs,
  });

  // Auto-populate from top 3 research results (processed summaries only)
  const results = data?.results || [];
  for (const r of results.slice(0, 3)) {
    const content = `${r.title || ''}: ${r.content || ''}`.trim();
    if (content) {
      try {
        await writeKnowledge(storeId, content, {
          type: 'research_result',
          title: r.title,
          source: 'tavily',
        });
      } catch (e) {
        console.warn('writeKnowledge research result failed', e);
      }
    }
  }

  return { keyword, summary: text, raw: data, type, brandVoice, knowledge };
}
