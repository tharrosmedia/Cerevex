import { inngest } from '../client';
import { applyWordpressMutation } from '@brain/lib/wordpress/apply';
import { updateJobStatus } from '@brain/lib/db/jobs';

export const wordpressApplyFn = inngest.createFunction(
  { id: 'seo-wordpress-apply', retries: 1, triggers: [{ event: 'seo/wordpress.apply' }] },
  async ({ event, step }: any) => {
    const { storeId, payload, actor, jobId } = event.data || {};
    const result = await step.run('apply-wordpress', async () => {
      if (!storeId || !payload) {
        return { ok: false, writes: false, code: 'invalid_payload', reason: 'That change is not valid.' };
      }
      return applyWordpressMutation({ storeId, payload, actor, jobId });
    });
    if (jobId) {
      await step.run('update-job', async () => {
        await updateJobStatus(jobId, result.ok ? 'completed' : 'failed', result);
      });
    }
    return result;
  }
);
