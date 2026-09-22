import { inngest } from '../client';
import { writeDraft } from '@brain/lib/agents/seo/writer';

export const writeDraftFn = inngest.createFunction(
  { id: 'seo-write-draft', retries: 2, triggers: [{ event: 'seo/write-draft' }] },
  async ({ event, step }: any) => {
    const { storeId, brief, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products, metafieldSamples, storeName, productTypes, mode, liveSnapshot, gscQueries } = event.data;
    return await step.run('write-draft', async () => {
      return writeDraft({ storeId, brief, type, platform, brandVoice, seoRules, metafieldDefinitions, placement, products, metafieldSamples, storeName, productTypes, mode, liveSnapshot, gscQueries });
    });
  }
);
