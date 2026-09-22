import { inngest } from '../client';
import { logEvent } from '@brain/lib/brain/events';

export const logEventFn = inngest.createFunction(
  { id: 'log-event', retries: 1, triggers: [{ event: 'log-event' }] },
  async ({ event, step }: any) => {
    const { storeId, actor, action, payload = {}, jobId } = event.data;
    await step.run('log-event', async () => {
      await logEvent(storeId, actor, action, payload, jobId);
    });
  }
);
