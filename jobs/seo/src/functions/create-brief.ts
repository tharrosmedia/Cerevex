import { inngest } from '../client';
import { createBrief } from '@brain/lib/agents/seo/brief';

export const createBriefFn = inngest.createFunction(
  { id: 'seo-create-brief', retries: 2, triggers: [{ event: 'seo/create-brief' }] },
  async ({ event, step }: any) => {
    const { storeId, keyword, research, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products, metafieldSamples, storeName, productTypes } = event.data;
    return await step.run('create-brief', async () => {
      return createBrief({ storeId, keyword, research, type, platform, brandVoice, seoRules, metafieldDefinitions, placement, products, metafieldSamples, storeName, productTypes });
    });
  }
);
