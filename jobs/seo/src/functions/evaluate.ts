import { inngest } from '../client';
import { evaluate } from '@brain/lib/agents/core/evaluate';

export const evaluateFn = inngest.createFunction(
  { id: 'seo-evaluate', retries: 2, triggers: [{ event: 'seo/evaluate' }] },
  async ({ event, step }: any) => {
    const { draft, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products, brief, research } = event.data;
    return await step.run('evaluate', async () => {
      return evaluate(draft, type, platform, brandVoice, seoRules, metafieldDefinitions, placement, products, brief, research);
    });
  }
);
