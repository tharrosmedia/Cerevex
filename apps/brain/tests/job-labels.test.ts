import assert from 'node:assert/strict';
import { countsAsSeoUsage, stableUsageJobId } from '../src/lib/db/jobs';
import { jobInputDetails, jobInputLabel, jobStatusLabel, jobStatusTone, jobSubject, jobTypeLabel } from '../lib/job-labels';

assert.equal(countsAsSeoUsage('seo', 'collection'), true);
assert.equal(countsAsSeoUsage('seo', 'seo.wordpress'), false);
assert.equal(countsAsSeoUsage('ads', 'collection'), false);
assert.equal(stableUsageJobId('evt-1'), stableUsageJobId('evt-1'));
assert.notEqual(stableUsageJobId('evt-1'), stableUsageJobId('evt-2'));
assert.match(stableUsageJobId('evt-1'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

assert.equal(jobTypeLabel('seo.generate'), 'SEO create');
assert.equal(jobTypeLabel('seo.wordpress'), 'WordPress change');
assert.equal(jobTypeLabel('blog'), 'Blog post');
assert.equal(jobTypeLabel('collection'), 'Collection');

assert.equal(jobSubject({ keyword: 'hvac filters', platform: 'shopify' }), 'hvac filters');
assert.equal(jobSubject({ title: 'About us', shopifyId: 'gid://shopify/Page/1' }), 'About us');
assert.equal(jobSubject({ gscQueries: ['', 'mini split sizing'] }), 'mini split sizing');
assert.equal(jobSubject({ platform: 'shopify' }), null);
assert.equal(jobSubject(null), null);
assert.equal(jobStatusLabel('snoozed'), 'Snoozed');
assert.equal(jobStatusTone('snoozed'), 'info');
assert.equal(jobStatusLabel('awaiting_approval'), 'Needs review');
assert.equal(jobStatusLabel('completed'), 'Done');
assert.equal(jobStatusTone('completed'), 'trust');
assert.equal(jobStatusTone('approved'), 'trust');
assert.equal(jobStatusTone('queued'), 'warn');
assert.equal(jobStatusTone('awaiting_approval'), 'warn');
assert.equal(jobStatusTone('failed'), 'danger');
assert.equal(jobStatusTone('rejected'), 'danger');

assert.equal(
  jobInputLabel({ keyword: 'Blog post draft', platform: 'shopify', mode: 'create' }, 'seo.create'),
  'SEO create — Blog post draft',
);
assert.equal(jobInputLabel({ title: 'About us' }), 'SEO — About us');
assert.equal(jobInputLabel({}), 'No details');
assert.equal(jobInputLabel(null), 'No details');
assert.ok(!jobInputLabel({ keyword: 'hvac repair' }).includes('{'));
assert.ok(!jobInputLabel({ keyword: 'hvac repair' }).includes('"'));
assert.deepEqual(jobInputDetails({ keyword: 'hvac repair', platform: 'shopify' }), [
  'Keyword: hvac repair',
  'Platform: shopify',
]);

console.log('job-labels: ok');
