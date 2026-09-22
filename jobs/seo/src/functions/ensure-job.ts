import { inngest } from '../client';
import { createJob } from '@brain/lib/db/jobs';

export const ensureJob = inngest.createFunction(
  { id: 'seo-ensure-job', retries: 2, triggers: [{ event: 'seo/ensure-job' }] },
  async ({ event, step }: any) => {
    const { storeId, keyword, type = 'collection', platform = 'shopify', brandVoice, jobId: providedJobId, mode, shopifyId, liveSnapshot, gscQueries } = event.data;
    if (providedJobId) {
      return { id: providedJobId };
    }
    return await step.run('ensure-create-job', async () => {
      return createJob({ storeId, domain: 'seo', type, input: { keyword, platform, brandVoice, mode, shopifyId, liveSnapshot, gscQueries } });
    });
  }
);
