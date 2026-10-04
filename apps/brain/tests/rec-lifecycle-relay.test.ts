import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const approve = readFileSync(join(here, '../app/api/approve/route.ts'), 'utf8');
const decide = readFileSync(join(here, '../app/api/ads/decide/route.ts'), 'utf8');
assert.equal(approve.includes('relayApproveToAuditLog'), false);
assert.equal(approve.includes('/recommendations/lifecycle'), false);
assert.equal(approve.includes('rec-lifecycle-relay'), false);
assert.ok(decide.includes('authorizeApprover'));
assert.ok(decide.includes('mark_done'));
assert.ok(decide.includes('rollback'));

const page = readFileSync(join(here, '../app/ads/audit-log/page.tsx'), 'utf8');
assert.ok(page.includes('btn-cta'));
assert.ok(page.includes('<details>'));
assert.ok(page.includes('Nobody can edit or delete them'));

console.log('rec lifecycle relay removed: ok');
