import { generateText } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { getStore, updateStore } from '../../db/stores';
import { createAdminClient } from '../../shopify/client';
import { fetchStoreSamples, searchBrandContext, fetchMetafieldValueSamples } from '../../shopify/content';
import { buildBrandVoiceMessages } from '../../prompts/brand/voice';
import { writeKnowledge, retrieve } from '../../brain/memory';

export async function inferBrandVoice({ storeId }: { storeId: string }) {
  const store = await getStore(storeId);
  if (!store || !store.shopify_access_token) {
    throw new Error(`No Shopify credentials for store ${storeId}`);
  }
  const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
  const samples = await fetchStoreSamples(client);

  // Auto-populate knowledge from site samples (up to 5 for cost efficiency)
  for (const s of samples.slice(0, 5)) {
    try {
      await writeKnowledge(storeId, `${s.title}: ${s.body}`, {
        type: 'shopify_sample',
        title: s.title,
        source: 'shopify',
      });
    } catch (e) {
      console.warn('writeKnowledge sample failed', e);
    }
  }

  // Load full metafield schema + actual values so brand voice accounts for site's structure and usage
  let mfSamples: any = null;
  try {
    mfSamples = await fetchMetafieldValueSamples(client);
    const schemaStr = JSON.stringify(mfSamples).slice(0, 8000);
    await writeKnowledge(storeId, `Full store metafield schema and current values: ${schemaStr}`, {
      type: 'metafield_schema_full',
      source: 'brand_inference',
    });
    // Persist to store config
    const currentConfig = store.config || {};
    const newConfig = {
      ...currentConfig,
      metafieldSchema: {
        definitions: Object.values(mfSamples).flatMap((s: any) => s.definitions || []),
        samples: mfSamples,
        lastRefreshed: new Date().toISOString(),
      },
    };
    await updateStore(storeId, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: newConfig,
    });
  } catch (e) {
    console.warn('writeKnowledge metafield schema failed', e);
  }

  let tavilyData: any = null;
  try {
    tavilyData = await searchBrandContext(store.shopify_domain, store.name);
  } catch {}
  const knowledge = await retrieve(storeId, store.name || 'brand', 3);
  // Also explicitly pull full metafield schema for brand awareness of site structure/values
  const schemaKnowledge = await retrieve(storeId, 'metafield schema', 2);
  const allKnowledge = [...knowledge, ...schemaKnowledge];
  const allMsgs = buildBrandVoiceMessages(samples, tavilyData, allKnowledge);
  const sys = allMsgs.find(m => m.role === 'system')?.content;
  const userMsgs = allMsgs.filter(m => m.role !== 'system');
  const { text } = await generateText({
    model: xai(XAI_MODEL),
    system: sys,
    messages: userMsgs,
  });

  const voiceText = (text || '').trim();

  // Auto-populate the generated brand voice
  if (voiceText) {
    try {
      await writeKnowledge(storeId, voiceText, {
        type: 'brand_voice',
        source: 'inference',
      });
    } catch (e) {
      console.warn('writeKnowledge brand voice failed', e);
    }
  }

  return {
    text: voiceText,
    allowedClaims: [],
    forbiddenClaims: [],
    inferredAt: new Date().toISOString(),
    samplesUsed: samples.length,
  };
}
