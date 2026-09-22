import { serve } from 'inngest/next';
import { inngest } from '../../../src/inngest/client';
import { functions } from '../../../src/inngest/index';

console.log('[INNGEST] serve route loaded, functions:', functions.length);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
