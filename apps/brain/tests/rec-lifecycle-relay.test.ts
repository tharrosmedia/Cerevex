import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleBodyFromApprove } from '../lib/rec-lifecycle-relay';

assert.equal(lifecycleBodyFromApprove({ jobId: 'seo-1', status: 'approved' }), null);
assert.deepEqual(
  lifecycleBodyFromApprove({
    clientId: '11111111-1111-1111-1111-111111111111',
    recommendationId: '22222222-2222-2222-2222-222222222222',
    status: 'approved',
    storeId: 'store-1',
  }),
  {
    kind: 'approved',
    clientId: '11111111-1111-1111-1111-111111111111',
    recommendationId: '22222222-2222-2222-2222-222222222222',
    storeId: 'store-1',
    module: 'ads',
  },
);
assert.equal(
  lifecycleBodyFromApprove({
    clientId: '11111111-1111-1111-1111-111111111111',
    status: 'prompt_layer_approved',
    version: 'hvac-usa@v2',
  })?.kind,
  'prompt_layer_approved',
);

const here = dirname(fileURLToPath(import.meta.url));
const approve = readFileSync(join(here, '../app/api/approve/route.ts'), 'utf8');
const decide = readFileSync(join(here, '../app/api/ads/decide/route.ts'), 'utf8');
assert.equal(approve.includes('relayApproveToAuditLog'), false);
assert.equal(approve.includes('/recommendations/lifecycle'), false);
assert.ok(decide.includes('consoleAuthorized'));
assert.ok(decide.includes('mark_done'));
assert.ok(decide.includes('rollback'));

const page = readFileSync(join(here, '../app/ads/audit-log/page.tsx'), 'utf8');
assert.ok(page.includes('btn-cta'));
assert.ok(page.includes('<details>'));
assert.ok(page.includes('Nobody can edit or delete them'));

console.log('rec lifecycle relay: ok');
