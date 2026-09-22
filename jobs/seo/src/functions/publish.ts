import { inngest } from '../client';
import { publishContent } from '@brain/lib/agents/seo/publisher';

export const publishFn = inngest.createFunction(
  { id: 'seo-publish', retries: 2, triggers: [{ event: 'seo/publish' }] },
  async ({ event, step }: any) => {
    const { storeId, draft, type = 'collection', platform, brandVoice, products, metafieldDefinitions, mode, shopifyId } = event.data;
    return await step.run('publish-content', async () => {
      return publishContent({ storeId, draft, type, platform, brandVoice, products, metafieldDefinitions, mode, shopifyId });
    });
  }
);
