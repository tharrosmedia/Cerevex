import { inngest } from '../client';
import { research } from '@brain/lib/agents/seo/research';

export const researchFn = inngest.createFunction(
  { id: 'seo-research', retries: 2, triggers: [{ event: 'seo/research' }] },
  async ({ event, step }: any) => {
    const { storeId, keyword, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products, metafieldSamples, storeName, productTypes } = event.data;
    return await step.run('do-research', async () => {
      return research({ storeId, keyword, type, platform, brandVoice, seoRules, metafieldDefinitions, placement, products, metafieldSamples, storeName, productTypes });
    });
  }
);
