import { inngest } from '../client';
import { reviseDraft } from '@brain/lib/agents/seo/revise-draft';

export const reviseDraftFn = inngest.createFunction(
  // Internal-only (no event triggers). Invoked exclusively via step.invoke from the main seo-job
  // as part of the grader-driven revision loop. Do not trigger directly.
  { id: 'seo-revise-draft', retries: 2 },
  async ({ event, step }: any) => {
    const { draft, feedback, type = 'collection', platform, brandVoice, seoRules, metafieldDefinitions, placement, products, brief, research, metafieldSamples, storeName, productTypes, mode, liveSnapshot, gscQueries } = event.data;
    return await step.run('revise-draft', async () => {
      return reviseDraft({ draft, feedback, type, platform, brandVoice, seoRules, metafieldDefinitions, placement, products, brief, research, metafieldSamples, storeName, productTypes, mode, liveSnapshot, gscQueries });
    });
  }
);
