import { inngest } from '../client';
import { updateJobStatus } from '@brain/lib/db/jobs';

export const updateJobStatusFn = inngest.createFunction(
  { id: 'update-job-status', retries: 2, triggers: [{ event: 'update-job-status' }] },
  async ({ event, step }: any) => {
    const { jobId, status, output } = event.data;
    await step.run('update-status', async () => {
      await updateJobStatus(jobId, status, output);
    });
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/');
    revalidatePath('/review');
  }
);
