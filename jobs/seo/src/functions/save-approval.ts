import { inngest } from '../client';
import { saveApproval } from '@brain/lib/db/approvals';

export const saveApprovalFn = inngest.createFunction(
  { id: 'seo-save-approval', retries: 2, triggers: [{ event: 'seo/save-approval' }] },
  async ({ event, step }: any) => {
    const { jobId, storeId, status, reviewerNotes, editedPayload } = event.data;
    return await step.run('save-approval', async () => {
      return saveApproval({ jobId, storeId, status, reviewerNotes, editedPayload });
    });
  }
);
