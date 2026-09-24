import assert from 'node:assert/strict';
import { jobInputDetails, jobInputLabel, jobStatusLabel, jobStatusTone, jobTypeLabel } from '../lib/job-labels';

assert.equal(jobTypeLabel('seo.generate'), 'SEO create');
assert.equal(jobTypeLabel('seo.wordpress'), 'WordPress change');
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
