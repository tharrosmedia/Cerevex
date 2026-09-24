import { inngest } from '../client';
import { getStore } from '@brain/lib/db/stores';
import { updateJobStatus } from '@brain/lib/db/jobs';
import { logEvent } from '@brain/lib/brain/events';
import { publishContent } from '@brain/lib/agents/seo/publisher';
import { applyWordpressMutation } from '@brain/lib/wordpress/apply';
import { isWordpressStore } from '@brain/lib/wordpress/store';
import { gscApplyIsWritable, gscApplyWriteBlockedReason, isGscSourcedJob } from '@brain/lib/seo/gsc-flags';

export const gscApplyFn = inngest.createFunction(
  { id: 'seo-gsc-apply', retries: 1, triggers: [{ event: 'seo/gsc.apply.requested' }] },
  async ({ event, step }: any) => {
    const data = event.data || {};
    return await step.run('gsc-apply', async () => {
      const storeId = data.storeId;
      const jobId = data.jobId;
      const action = data.action || 'approve';
      if (!storeId) return { ok: false, writes: false, reason: 'missing_store' };
      if (action === 'denied' || action === 'rejected' || action === 'snoozed' || action === 'dismissed') {
        await logEvent(storeId, data.actor || 'human', `gsc.apply.${action}`, { jobId, writes: false }, jobId);
        if (jobId) await updateJobStatus(jobId, action === 'snoozed' ? 'snoozed' : 'rejected');
        return { ok: true, writes: false, reason: action };
      }
      const store = await getStore(storeId);
      const blocked = gscApplyWriteBlockedReason(store);
      if (!store || blocked || !gscApplyIsWritable(store) || !isGscSourcedJob(data)) {
        await logEvent(storeId, data.actor || 'system', 'gsc.apply.blocked', {
          jobId,
          reason: blocked || 'flag_off',
          writes: false,
        }, jobId);
        if (jobId) await updateJobStatus(jobId, 'approved');
        return { ok: true, writes: false, reason: blocked || 'flag_off' };
      }
      if (isWordpressStore(store)) {
        const result = await applyWordpressMutation({
          storeId,
          payload: data.payload,
          actor: data.actor || 'human',
          jobId,
        });
        if (jobId) await updateJobStatus(jobId, result.ok ? 'completed' : 'failed', result);
        return result;
      }
      try {
        const result = await publishContent({
          storeId,
          draft: data.draft,
          type: data.type || 'page',
          platform: store.platform || 'shopify',
          mode: data.mode || 'improve',
          shopifyId: data.shopifyId,
        });
        await logEvent(storeId, data.actor || 'human', 'gsc.apply.succeeded', { jobId, writes: true }, jobId);
        if (jobId) await updateJobStatus(jobId, 'completed', result);
        return { ok: true, writes: true, result };
      } catch (error: any) {
        await logEvent(storeId, data.actor || 'system', 'gsc.apply.failed', {
          jobId,
          writes: false,
          error: error?.message || String(error),
        }, jobId);
        if (jobId) await updateJobStatus(jobId, 'failed', { error: error?.message || String(error) });
        return { ok: false, writes: false, reason: error?.message || 'publish_failed' };
      }
    });
  },
);
